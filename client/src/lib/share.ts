/** Share helpers. Uses the native sheet on mobile, clipboard everywhere else. */

export function joinUrlFor(code: string): string {
  return `${window.location.origin}/join?code=${encodeURIComponent(code)}`;
}

export function shareMessage(albumName: string, code: string): string {
  return `Join our ${albumName} photo album.\n\nOpen ${joinUrlFor(code)} and enter:\n\n${code}`;
}

export async function shareAlbum(albumName: string, code: string): Promise<"shared" | "copied" | "failed"> {
  const text = shareMessage(albumName, code);

  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title: albumName, text, url: joinUrlFor(code) });
      return "shared";
    } catch (error) {
      // The user dismissing the sheet is not a failure worth reporting.
      if ((error as Error)?.name === "AbortError") return "failed";
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
