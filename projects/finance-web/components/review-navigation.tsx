"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const reviewDestinations = [
  { href: "/review", label: "Matched sources" },
  { href: "/messages/review", label: "SMS" },
  { href: "/statements", label: "Statements" },
] as const;

export function isReviewPath(pathname: string) {
  return reviewDestinations.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}

export function ReviewNavigation({
  pendingSms,
}: {
  pendingSms: number | null;
}) {
  const pathname = usePathname();
  return (
    <nav className="review-navigation" aria-label="Review inbox views">
      {reviewDestinations.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={(event) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            if (
              active &&
              event.button === 0 &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.shiftKey &&
              !event.altKey
            ) {
              event.preventDefault();
            }
          }}
          aria-current={
            pathname === item.href || pathname.startsWith(`${item.href}/`)
              ? "page"
              : undefined
          }
        >
          {item.label}
          {item.href === "/messages/review" && pendingSms !== null ? (
            <span aria-label={`${pendingSms} pending SMS`}>{pendingSms}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
