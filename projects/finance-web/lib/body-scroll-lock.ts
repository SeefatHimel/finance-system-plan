let locks = 0;
let previousOverflow = "";

/** Shared by nested dialogs and in-place Focus mode; release order is irrelevant. */
export function lockBodyScroll() {
  if (locks++ === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) document.body.style.overflow = previousOverflow;
  };
}
