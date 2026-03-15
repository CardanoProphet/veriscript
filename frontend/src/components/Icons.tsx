interface IconProps {
  className?: string;
}

const base = "fill-none";
const stroked = (d: string, strokeWidth = 2) => (
  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d={d} />
);

export function Shield({ className }: IconProps) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" stroke="currentColor">
      {stroked("M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z")}
    </svg>
  );
}

export function Plus({ className }: IconProps) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" stroke="currentColor">
      {stroked("M12 4v16m8-8H4")}
    </svg>
  );
}

export function ChevronDown({ className }: IconProps) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" stroke="currentColor">
      {stroked("M19 9l-7 7-7-7")}
    </svg>
  );
}

export function LogOut({ className }: IconProps) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" stroke="currentColor">
      {stroked("M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1")}
    </svg>
  );
}

export function ExternalLink({ className }: IconProps) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" stroke="currentColor">
      {stroked("M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14")}
    </svg>
  );
}

export function Pen({ className }: IconProps) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" stroke="currentColor">
      {stroked("M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z")}
    </svg>
  );
}

export function Trash({ className }: IconProps) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" stroke="currentColor">
      {stroked("M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16")}
    </svg>
  );
}

export function Warning({ className }: IconProps) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" stroke="currentColor">
      {stroked("M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z")}
    </svg>
  );
}

export function Users({ className }: IconProps) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" stroke="currentColor">
      {stroked("M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z")}
    </svg>
  );
}

export function Wallet({ className }: IconProps) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" stroke="currentColor">
      {stroked("M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z")}
    </svg>
  );
}

export function Document({ className }: IconProps) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" stroke="currentColor">
      {stroked("M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", 1)}
    </svg>
  );
}

export function Mail({ className }: IconProps) {
  return (
    <svg className={`${base} ${className}`} viewBox="0 0 24 24" stroke="currentColor">
      {stroked("M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z")}
    </svg>
  );
}
