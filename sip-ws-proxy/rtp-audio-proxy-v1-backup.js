const dgram = require('dgram');
const http = require('http');
const { WebSocketServer } = require('ws');

const RTP_PORT = 20000;
const AUDIO_WS_PORT = 5067;

const rtpSocket = dgram.createSocket('udp4');
const audioServer = http.createServer((req, res) => { res.writeHead(200); res.end('RTP Audio Proxy'); });
const audioWss = new WebSocketServer({ server: audioServer });

let audioWsClient = null;
let rtpRemoteAddr = null;
let rtpRemotePort = null;

rtpSocket.bind(RTP_PORT, '0.0.0.0', () => {
  console.log('[RTP-PROXY] Listening for RTP on UDP port', RTP_PORT);
});

rtpSocket.on('message', (msg, rinfo) => {
  if (!rtpRemoteAddr) {
    rtpRemoteAddr = rinfo.address;
    rtpRemotePort = rinfo.port;
    console.log('[RTP-PROXY] First RTP packet from', rinfo.address + ':' + rinfo.port, 'size:', msg.length);
  }
  
  if (audioWsClient && audioWsClient.readyState === 1) {
    audioWsClient.send(msg);
  }
});

audioWss.on('connection', (ws) => {
  console.log('[RTP-PROXY] Audio WS client connected');
  audioWsClient = ws;
  
  ws.on('message', (data) => {
    if (rtpRemoteAddr && rtpRemotePort) {
      rtpSocket.send(data, rtpRemotePort, rtpRemoteAddr);
    }
  });
  
  ws.on('close', () => {
    console.log('[RTP-PROXY] Audio WS client disconnected');
    if (audioWsClient === ws) audioWsClient = null;
  });
});

audioServer.listen(AUDIO_WS_PORT, '0.0.0.0', () => {
  console.log('[RTP-PROXY] Audio WS listening on port', AUDIO_WS_PORT);
});
