export class AuthRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "AuthRequestError";
  }
}

export function isAuthenticationFailure(error: unknown) {
  return error instanceof AuthRequestError && error.status === 401;
}
