declare module 'react' {
  export type ReactNode = any
  export type SVGProps<T> = any
  export type KeyboardEvent<T = any> = any
  export function useState<T>(value: T | (() => T)): [T, (value: T | ((current: T) => T)) => void]
  export function useEffect(effect: () => void | (() => void), deps?: any[]): void
  export function useMemo<T>(factory: () => T, deps: any[]): T
  export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T
  export function useRef<T>(value: T): { current: T }
  const React: { StrictMode: any }
  export default React
}
declare module 'react-dom/client' { const ReactDOM: { createRoot(element: Element): { render(node: any): void } }; export default ReactDOM }
declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any }
declare namespace React { type ReactNode = any; type KeyboardEvent<T = any> = any }
declare namespace JSX { interface IntrinsicElements { [elemName: string]: any } }
declare module '*.css' { const value: any; export default value }
