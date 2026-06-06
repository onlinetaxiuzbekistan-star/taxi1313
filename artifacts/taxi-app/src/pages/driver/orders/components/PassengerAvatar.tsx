interface PassengerAvatarProps {
  gender: string | null | undefined;
  size?: number;
  className?: string;
}

export function PassengerAvatar({ gender, size = 28, className }: PassengerAvatarProps) {
  const isFemale = gender === "female";

  if (isFemale) {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className}>
        <path d="M9 18C9 9 13 4 20 4C27 4 31 9 31 18C31 21 30.5 23 29.5 24.5C29 23 27 22 25 22H15C13 22 11 23 10.5 24.5C9.5 23 9 21 9 18Z" fill="currentColor" opacity="0.45" />
        <circle cx="20" cy="15" r="6" fill="currentColor" opacity="0.95" />
        <path d="M11 36C11 28 14.5 22 20 22C25.5 22 29 28 29 36L33 38H7L11 36Z" fill="currentColor" opacity="0.75" />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className}>
      <circle cx="20" cy="14" r="6" fill="currentColor" opacity="0.95" />
      <path d="M9 34C9 27 13 23 20 23C27 23 31 27 31 34" fill="currentColor" opacity="0.75" />
    </svg>
  );
}
