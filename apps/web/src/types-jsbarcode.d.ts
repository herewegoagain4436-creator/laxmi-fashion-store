declare module 'jsbarcode' {
  interface JsBarcodeOptions {
    format?: string
    width?: number
    height?: number
    displayValue?: boolean
    fontSize?: number
    margin?: number
  }
  export default function JsBarcode(
    element: string | HTMLElement | SVGElement,
    data: string,
    options?: JsBarcodeOptions,
  ): void
}
