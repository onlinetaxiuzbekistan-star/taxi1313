if (typeof window !== "undefined") {
  // Try-catch polyfills: some WebView have the constructors defined but they THROW "Illegal constructor"
  const safePoly = (name: string, FakeCls: any) => {
    try {
      new (window as any)[name]();
    } catch (_e) {
      (window as any)[name] = FakeCls;
    }
  };

  safePoly("MessageChannel", class MessageChannel {
    port1: any;
    port2: any;
    constructor() {
      const h1: Record<string, Function[]> = {};
      const h2: Record<string, Function[]> = {};
      this.port1 = {
        postMessage(msg: any) { setTimeout(() => { (h2.message || []).forEach(fn => fn({ data: msg })); }, 0); },
        addEventListener(t: string, fn: Function) { h1[t] = h1[t] || []; h1[t].push(fn); },
        removeEventListener(t: string, fn: Function) { if (h1[t]) h1[t] = h1[t].filter(f => f !== fn); },
        onmessage: null as any,
        close() {},
        start() {},
      };
      this.port2 = {
        postMessage(msg: any) { setTimeout(() => { (h1.message || []).forEach(fn => fn({ data: msg })); }, 0); },
        addEventListener(t: string, fn: Function) { h2[t] = h2[t] || []; h2[t].push(fn); },
        removeEventListener(t: string, fn: Function) { if (h2[t]) h2[t] = h2[t].filter(f => f !== fn); },
        onmessage: null as any,
        close() {},
        start() {},
      };
    }
  });

  safePoly("BroadcastChannel", class BroadcastChannel {
    name: string;
    onmessage: any = null;
    constructor(name?: string) { this.name = name || ""; }
    postMessage() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  });

  safePoly("PerformanceObserver", class PerformanceObserver {
    constructor(_cb?: any) {}
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
  });

  safePoly("ResizeObserver", class ResizeObserver {
    constructor(_cb?: any) {}
    observe() {}
    unobserve() {}
    disconnect() {}
  });

  safePoly("MutationObserver", class MutationObserver {
    constructor(_cb?: any) {}
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
  });

  // Also wrap RTCPeerConnection, AudioContext, Notification
  const dangerousAPIs = ["RTCPeerConnection", "AudioContext", "webkitAudioContext", "Notification", "MediaRecorder"];
  for (const api of dangerousAPIs) {
    if (typeof (window as any)[api] !== "undefined") {
      const Orig = (window as any)[api];
      try { new Orig(); } catch (e: any) {
        if (e?.message?.includes("Illegal constructor")) {
          (window as any)[api] = undefined;
        }
      }
    }
  }
}
