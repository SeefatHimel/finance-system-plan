import { RequestError } from "./api-errors";
export function fieldErrorsFrom(error: unknown): Record<string, string> {
  return error instanceof RequestError ? error.fieldErrors : {};
}
export function nativeFieldErrors(form: HTMLFormElement): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const control of Array.from(form.elements)) {
    if ((control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) && control.name && control.willValidate && !control.validity.valid) {
      errors[control.name] = control.validationMessage;
    }
  }
  return errors;
}
export function focusFieldError(form: HTMLFormElement | null, errors: Record<string, string>) {
  if (!form) return;
  const control = Array.from(form.elements).find(element => element instanceof HTMLElement && "name" in element && errors[String(element.name)] && !("disabled" in element && element.disabled) && !(element instanceof HTMLInputElement && element.type === "hidden")) as HTMLElement | undefined;
  if (!control) return;
  for (let parent = control.parentElement; parent && parent !== form; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  control.focus(); control.scrollIntoView({ block: "nearest" });
}
