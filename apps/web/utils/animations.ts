// Source: web-animation-design skill (Emil Kowalski, animations.dev).
// ease-out for entrance, <300ms duration, subtle offset, reduced-motion variant.

export const easeOut = [0.23, 1, 0.32, 1] as const; // ease-out-quint

export const reveal = {
  hidden: { opacity: 0, transform: "translateY(8px)" },
  visible: (delay: number = 0) => ({
    opacity: 1,
    transform: "translateY(0)",
    transition: {
      delay,
      duration: 0.22,
      ease: easeOut,
    },
  }),
};

export const revealReduced = {
  hidden: { opacity: 1, transform: "translateY(0)" },
  visible: () => ({
    opacity: 1,
    transform: "translateY(0)",
    transition: { duration: 0 },
  }),
};
