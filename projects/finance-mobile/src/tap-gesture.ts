type TouchPoint = { pageX: number; pageY: number };

/** Keeps a drag cancelled even when the finger returns to its starting point. */
export class TapGesture {
  private start: TouchPoint | null = null;
  private dragged = false;

  begin(point: TouchPoint) {
    this.start = { pageX: point.pageX, pageY: point.pageY };
    this.dragged = false;
  }

  move(point: TouchPoint) {
    if (this.start && Math.hypot(point.pageX - this.start.pageX, point.pageY - this.start.pageY) > 8) {
      this.dragged = true;
    }
  }

  reset() {
    this.start = null;
    this.dragged = false;
  }

  finish(point: TouchPoint) {
    this.move(point);
    const activate = !this.dragged;
    this.reset();
    return activate;
  }
}
