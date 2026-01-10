/**
 * Custom error class for GoFindMe API errors
 */
export class GoFindMeError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'GoFindMeError';
    Object.setPrototypeOf(this, GoFindMeError.prototype);
  }

  static async fromResponse(response: Response): Promise<GoFindMeError> {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    let errorData: unknown = null;

    try {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        errorData = await response.json();
        errorMessage = (errorData as { message?: string })?.message || errorMessage;
      } else {
        const text = await response.text();
        if (text) {
          errorMessage = text;
          errorData = text;
        }
      }
    } catch {
      // Ignore parsing errors, use default message
    }

    return new GoFindMeError(errorMessage, response.status, errorData);
  }
}
