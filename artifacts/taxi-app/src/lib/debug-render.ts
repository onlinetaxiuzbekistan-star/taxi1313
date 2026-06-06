import React from "react";

const origCreateElement = React.createElement;

(React as any).createElement = function debugCreateElement(type: any, ...args: any[]) {
  const name = typeof type === "function" 
    ? (type.displayName || type.name || "Anonymous") 
    : (typeof type === "string" ? type : "unknown");
  
  const stack = (window as any).__DEBUG_COMPONENT_STACK__;
  if (stack && typeof type === "function") {
    if (stack.length > 100) stack.shift();
    stack.push(name);
  }
  
  return origCreateElement.call(React, type, ...args);
};

export {};
