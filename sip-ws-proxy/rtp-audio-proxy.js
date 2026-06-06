const dgram = require('dgram');
const http = require('http');
const { WebSocketServer } = require('ws');

const RTP_PORT = 20000;
const AUDIO_WS_PORT = 5067;

const rtpSocket = dgram.createSocket('udp4');

let audioWsClient = null;
let rtpRemoteAddr = null;
let rtpRemotePort = null;
let rtpInCount = 0;
let wsInCount = 0;
let lastSrcLogged = null;

rtpSocket.bind(RTP_PORT, '0.0.0.0', () => {
  console.log('[RTP-PROXY] Listening for RTP on UDP port', RTP_PORT);
});

rtpSocket.on('message', (msg, rinfo) => {
  const srcKey = rinfo.address + ':' + rinfo.port;
  if (srcKey !== lastSrcLogged) {
    console.log('[RTP-PROXY] RTP source:', srcKey, '(dest stays:', rtpRemoteAddr + ':' + rtpRemotePort + ')');
    lastSrcLogged = srcKey;
  }

  rtpInCount++;
  if (rtpInCount % 100 === 1) {
    console.log('[RTP-PROXY] RTP packets received:', rtpInCount, 'src:', srcKey, 'wsConnected:', !!(audioWsClient && audioWsClient.readyState === 1));
  }

  if (audioWsClient && audioWsClient.readyState === 1) {
    audioWsClient.send(msg);
  }
});

rtpSocket.on('error', (err) => {
  console.error('[RTP-PROXY] UDP error:', err.message);
});

const audioServer = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/set-endpoint') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.fsIp && data.fsPort) {
          const oldEp = rtpRemoteAddr ? rtpRemoteAddr + ':' + rtpRemotePort : 'NONE';
          rtpRemoteAddr = data.fsIp;
          rtpRemotePort = data.fsPort;
          rtpInCount = 0;
          wsInCount = 0;
          lastSrcLogged = null;
          console.log('[RTP-PROXY] FreeSWITCH endpoint set:', oldEp, '=>', rtpRemoteAddr + ':' + rtpRemotePort, '(counters reset)');
          res.writeHead(200);
          res.end('OK');
        } else {
          res.writeHead(400);
          res.end('Missing fsIp/fsPort');
        }
      } catch (e) {
        res.writeHead(400);
        res.end('Invalid JSON');
      }
    });
    return;
  }

  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      wsConnected: !!(audioWsClient && audioWsClient.readyState === 1),
      rtpEndpoint: rtpRemoteAddr ? rtpRemoteAddr + ':' + rtpRemotePort : null
    }));
    return;
  }

  res.writeHead(200);
  res.end('RTP Audio Proxy v2');
});

const audioWss = new WebSocketServer({ server: audioServer });

audioWss.on('connection', (ws) => {
  console.log('[RTP-PROXY] Audio WS client connected, endpoint:', rtpRemoteAddr ? rtpRemoteAddr + ':' + rtpRemotePort : 'NOT SET');
  rtpInCount = 0;
  wsInCount = 0;

  if (audioWsClient && audioWsClient.readyState === 1) {
    console.log('[RTP-PROXY] Closing previous WS client');
    audioWsClient.close();
  }
  audioWsClient = ws;

  ws.on('message', (data) => {
    wsInCount++;
    if (wsInCount % 100 === 1) {
      console.log('[RTP-PROXY] WS audio packets received:', wsInCount, 'size:', data.length, 'rtpDest:', rtpRemoteAddr ? rtpRemoteAddr + ':' + rtpRemotePort : 'NOT SET');
    }
    if (rtpRemoteAddr && rtpRemotePort) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      rtpSocket.send(buf, rtpRemotePort, rtpRemoteAddr, (err) => {
        if (err) console.error('[RTP-PROXY] UDP send error:', err.message);
      });
    }
  });

  ws.on('close', () => {
    console.log('[RTP-PROXY] Audio WS client disconnected');
    if (audioWsClient === ws) audioWsClient = null;
  });

  ws.on('error', (err) => {
    console.error('[RTP-PROXY] WS error:', err.message);
  });
});

audioServer.listen(AUDIO_WS_PORT, '0.0.0.0', () => {
  console.log('[RTP-PROXY] Audio WS listening on port', AUDIO_WS_PORT);
});
