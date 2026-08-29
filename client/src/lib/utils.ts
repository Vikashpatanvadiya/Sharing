import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's stock scales. Our design tokens add
 * names it has never seen — `text-body` is a font size, not a colour — and
 * without this it treats them as conflicting with `text-primary-foreground`
 * and silently drops the colour, which is how a filled button ends up with a
 * dark label on a dark fill.
 *
 * Every custom key in tailwind.config.ts must be declared here.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "section",
            "subheading",
            "body",
            "label",
            "caption",
            "button",
            "eyebrow",
          ],
        },
      ],
      "font-weight": [{ font: ["regular", "medium", "semibold"] }],
      rounded: [{ rounded: ["card", "panel", "badge", "chip", "pill"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
