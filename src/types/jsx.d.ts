import type { JSX as ReactJSX } from 'react';

// React 19 removed the global JSX namespace; restore it so components can
// keep the concise `JSX.Element` return-type annotations used across the app.
declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    type ElementClass = ReactJSX.ElementClass;
    type ElementAttributesProperty = ReactJSX.ElementAttributesProperty;
    type ElementChildrenAttribute = ReactJSX.ElementChildrenAttribute;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
  }
}

export {};
