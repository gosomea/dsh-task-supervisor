/** Correctable model requests must not poison the administrator runtime. */
export class CheckInputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`CHECK_INPUT: ${message}`, options)
    this.name = 'CheckInputError'
  }
}
