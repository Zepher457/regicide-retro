import type { SVGProps } from "react";

export function SuitIcon({
  suit,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { suit: "hearts" | "diamonds" | "clubs" | "spades" }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "currentColor",
    "aria-hidden": true,
    className,
    ...props,
  } as SVGProps<SVGSVGElement>;

  if (suit === "hearts") {
    return (
      <svg {...common}>
        <path d="M12 21.3 4.2 13.5c-2.4-2.4-2.4-6.3 0-8.7s6.3-2.4 8.7 0L12 5.1l-.9-.9c2.4-2.4 6.3-2.4 8.7 0s2.4 6.3 0 8.7L12 21.3Z" />
      </svg>
    );
  }
  if (suit === "diamonds") {
    return (
      <svg {...common}>
        <path d="M12 2.2 21.2 12 12 21.8 2.8 12 12 2.2Z" />
      </svg>
    );
  }
  if (suit === "clubs") {
    return (
      <svg {...common}>
        <path d="M12 2.5c2.8 0 5 2.2 5 5 0 1.2-.4 2.2-1 3.1h.1c2.2 0 4 1.8 4 4s-1.8 4-4 4c-.9 0-1.7-.3-2.4-.8L13.2 21h-2.4l-.5-3.2c-.7.5-1.5.8-2.4.8-2.2 0-4-1.8-4-4s1.8-4 4-4h.1c-.6-.9-1-1.9-1-3.1 0-2.8 2.2-5 5-5Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 2.2 7.2 7c-2.7 2.7-4.2 5.2-4.2 7.6 0 3.2 2.5 5.8 5.7 5.8 1.5 0 2.8-.5 3.8-1.6l-.5 2.5H12l-.5-2.5c1 1.1 2.3 1.6 3.8 1.6 3.2 0 5.7-2.6 5.7-5.8 0-2.4-1.5-4.9-4.2-7.6L12 2.2Z" />
    </svg>
  );
}

export function CrownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="m3 8 4 3 5-7 5 7 4-3-1.6 11H4.6L3 8Zm2.8 9.5h12.4l.4-3.5H5.4l.4 3.5Z" />
    </svg>
  );
}

export function JesterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 3 9.7 7.8 4.5 6.4l2.5 4.7L3 15.4l5.8-.5L10 21l2-4.7 2 4.7 1.2-6.1 5.8.5-4-4.3 2.5-4.7-5.2 1.4L12 3Zm0 4.8 1.4 2.8-1.4 1.5-1.4-1.5L12 7.8Z" />
    </svg>
  );
}
