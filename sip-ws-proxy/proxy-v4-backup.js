const http = require('http');
const dgram = require('dgram');
const { WebSocketServer } = require('ws');

const SIP_HOST = '192.168.1.230';
const SIP_PORT = 5060;
const WS_PORT = 5065;
const LOCAL_SIP_PORT = 5066;

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('SIP WS Proxy OK (UDP v4)');
});

const wss = new WebSocketServer({ server, handleProtocols: () => 'sip' });

let activeWs = null;
const udpSocket = dgram.createSocket('udp4');

const waitingCallers = new Map();

udpSocket.bind(LOCAL_SIP_PORT, '0.0.0.0', () => {
  console.log('[SIP-WS-PROXY] UDP socket bound to port', LOCAL_SIP_PORT);
});

function extractCallerFromInvite(text) {
  const fromMatch = text.match(/From:\s*.*?sip:([^@>]+)/i);
  return fromMatch ? fromMatch[1] : null;
}

function extractCallId(text) {
  const m = text.match(/Call-ID:\s*(.+)/i);
  return m ? m[1].trim() : null;
}

function sendWaitingList() {
  if (!activeWs || activeWs.readyState !== 1) return;
  const list = [];
  for (const [callId, info] of waitingCallers) {
    list.push({ callId, number: info.number, since: info.since });
  }
  const msg = JSON.stringify({ type: 'waiting_calls', calls: list });
  activeWs.send('__JSON__' + msg);
}

udpSocket.on('message', (msg, rinfo) => {
  const text = msg.toString();
  const firstLine = text.split('\r\n')[0];
  console.log('[PROXY] FS->WS (UDP):', firstLine);

  if (text.startsWith('INVITE')) {
    const caller = extractCallerFromInvite(text);
    const callId = extractCallId(text);
    console.log('[PROXY] === INVITE from', caller, 'call-id:', callId, '===');

    if (caller && callId) {
      for (const [existingCallId, info] of waitingCallers) {
        if (info.number === caller) {
          waitingCallers.delete(existingCallId);
        }
      }
    }
  }

  if (text.startsWith('CANCEL')) {
    const callId = extractCallId(text);
    const caller = extractCallerFromInvite(text);
    console.log('[PROXY] CANCEL for call-id:', callId, 'caller:', caller);

    if (callId && caller && activeWs && activeWs.readyState === 1) {
      waitingCallers.set(callId, { number: caller, since: Date.now() });
      console.log('[PROXY] Added to waiting:', caller, '- total waiting:', waitingCallers.size);
      setTimeout(() => sendWaitingList(), 100);
    } else if (!activeWs || activeWs.readyState !== 1) {
      console.log('[PROXY] No active WS, not adding to waiting list');
    }
  }

  if (activeWs && activeWs.readyState === 1) {
    activeWs.send(text);
  } else {
    console.log('[PROXY] No active WS');
    if (text.startsWith('OPTIONS')) {
      const vias = text.split('\r\n').filter(l => l.toLowerCase().startsWith('via:')).join('\r\n');
      const from = text.match(/From:\s*(.+)/i)?.[1] || '';
      const to = text.match(/To:\s*(.+)/i)?.[1] || '';
      const callId = text.match(/Call-ID:\s*(.+)/i)?.[1] || '';
      const cseq = text.match(/CSeq:\s*(.+)/i)?.[1] || '';
      const reply = 'SIP/2.0 200 OK\r\n' + vias + '\r\nFrom: ' + from + '\r\nTo: ' + to + '\r\nCall-ID: ' + callId + '\r\nCSeq: ' + cseq + '\r\nContent-Length: 0\r\n\r\n';
      udpSocket.send(Buffer.from(reply), rinfo.port, rinfo.address);
    }
  }
});

udpSocket.on('error', (err) => {
  console.error('[PROXY] UDP error:', err.message);
});

function rewriteContactVia(sipMsg) {
  return sipMsg.replace(
    /Contact:\s*<sip:[^>]+>/i,
    'Contact: <sip:337@192.168.1.107:' + LOCAL_SIP_PORT + ';transport=udp>'
  ).replace(
    /Via:\s*SIP\/2\.0\/TCP\s+[^;]+/i,
    'Via: SIP/2.0/UDP 192.168.1.107:' + LOCAL_SIP_PORT
  ).replace(
    /Via:\s*SIP\/2\.0\/WS\s+[^;]+/i,
    'Via: SIP/2.0/UDP 192.168.1.107:' + LOCAL_SIP_PORT
  );
}

setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [callId, info] of waitingCallers) {
    if (now - info.since > 90000) {
      waitingCallers.delete(callId);
      removed++;
    }
  }
  if (removed > 0) {
    console.log('[PROXY] Cleaned', removed, 'old waiting callers, remaining:', waitingCallers.size);
    sendWaitingList();
  }
}, 10000);

wss.on('connection', (ws, req) => {
  console.log('[PROXY] New WS connection');

  if (activeWs && activeWs.readyState === 1) {
    if (activeWs._pingInterval) clearInterval(activeWs._pingInterval);
    activeWs.close();
  }
  activeWs = ws;

  waitingCallers.clear();
  console.log('[PROXY] Cleared waiting callers on new connection');

  ws._isAlive = true;
  ws.on('pong', () => { ws._isAlive = true; });

  ws._pingInterval = setInterval(() => {
    if (!ws._isAlive) {
      console.log('[PROXY] WS ping timeout, terminating');
      clearInterval(ws._pingInterval);
      ws.terminate();
      return;
    }
    ws._isAlive = false;
    try { ws.ping(); } catch(e) {}
  }, 25000);

  setTimeout(() => sendWaitingList(), 500);

  ws.on('message', (data) => {
    const msg = data.toString();
    const firstLine = msg.split('\r\n')[0];
    console.log('[PROXY] WS->FS:', firstLine);

    if (msg.startsWith('SIP/2.0 200') && msg.includes('application/sdp')) {
      console.log('[PROXY] === 200 OK SDP START ===');
      const sdpStart = msg.indexOf('\r\n\r\n');
      if (sdpStart > 0) {
        console.log(msg.substring(sdpStart + 4));
      }
      console.log('[PROXY] === 200 OK SDP END ===');
    }

    if (msg.startsWith('SIP/2.0 100') || msg.startsWith('SIP/2.0 180')) {
      const callId = extractCallId(msg);
      if (callId && waitingCallers.has(callId)) {
        waitingCallers.delete(callId);
        console.log('[PROXY] Removed from waiting (got response):', callId, '- remaining:', waitingCallers.size);
        sendWaitingList();
      }
      const caller = extractCallerFromInvite(msg);
      if (caller) {
        for (const [wCallId, info] of waitingCallers) {
          if (info.number === caller) {
            waitingCallers.delete(wCallId);
          }
        }
        sendWaitingList();
      }
    }

    const rewritten = rewriteContactVia(msg);
    udpSocket.send(Buffer.from(rewritten), SIP_PORT, SIP_HOST, (err) => {
      if (err) console.error('[PROXY] UDP send error:', err.message);
    });
  });

  ws.on('close', () => {
    console.log('[PROXY] WS closed, clearing waiting callers');
    if (ws._pingInterval) clearInterval(ws._pingInterval);
    if (activeWs === ws) activeWs = null;
    waitingCallers.clear();
  });

  ws.on('error', (err) => {
    console.error('[PROXY] WS error:', err.message);
  });
});

server.listen(WS_PORT, '0.0.0.0', () => {
  console.log('[SIP-WS-PROXY] WS listening on port', WS_PORT);
});
