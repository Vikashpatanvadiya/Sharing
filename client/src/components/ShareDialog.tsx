import { Check, Copy, QrCode, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCopy } from "@/hooks/use-copy";
import { toast } from "@/hooks/use-toast";
import { joinUrlFor, shareAlbum } from "@/lib/share";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  albumName: string;
  code: string;
  /** Only the album creator is given the code, so only they can pass it on. */
  isAdmin?: boolean;
}

export function ShareDialog({ open, onOpenChange, albumName, code, isAdmin = true }: ShareDialogProps) {
  const { copied, copy } = useCopy();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  // The QR library is only pulled in when someone actually asks for a code.
  useEffect(() => {
    if (!showQr || !open || qrDataUrl) return;
    let cancelled = false;
    void import("qrcode").then(async (module) => {
      // Encodes the *join* URL only — never the admin credential.
      const url = await module.default.toDataURL(joinUrlFor(code), {
        width: 480,
        margin: 2,
        errorCorrectionLevel: "M",
      });
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [showQr, open, code, qrDataUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {!isAdmin || !code ? (
          <>
            <DialogHeader>
              <DialogTitle>Share this album</DialogTitle>
              <DialogDescription>
                Ask the album creator for the code — only they can share it.
              </DialogDescription>
            </DialogHeader>
          </>
        ) : (
        <>
        <DialogHeader>
          <DialogTitle>Share this album</DialogTitle>
          <DialogDescription>
            Anyone with this code can view the album and add their own photos.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-panel border border-dashed border-brand-indigo/40 bg-accent px-6 py-7 text-center">
          <p className="text-eyebrow font-medium uppercase text-text-tertiary">Album code</p>
          <p className="code-chip selectable mt-2">{code}</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            variant="outline"
            onClick={async () => {
              const ok = await copy(code);
              toast(
                ok
                  ? { title: "Code copied" }
                  : { variant: "destructive", title: "Could not copy", description: "Copy it manually instead." },
              );
            }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy code"}
          </Button>

          <Button
            onClick={async () => {
              const result = await shareAlbum(albumName, code);
              if (result === "copied") toast({ title: "Invite copied to clipboard" });
            }}
          >
            <Share2 className="h-4 w-4" />
            Share
          </Button>
        </div>

        <Button variant="ghost" size="sm" onClick={() => setShowQr((value) => !value)}>
          <QrCode className="h-4 w-4" />
          {showQr ? "Hide QR code" : "Show QR code"}
        </Button>

        {showQr && (
          <div className="flex flex-col items-center gap-2 rounded-panel border border-border bg-card p-5">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt={`QR code to join ${albumName}`} className="h-48 w-48 rounded-card" />
            ) : (
              <div className="h-48 w-48 skeleton-shimmer rounded-card" />
            )}
            <p className="text-center text-caption text-text-tertiary">
              Scan to open the join page with the code filled in.
            </p>
          </div>
        )}

        <p className="text-center text-caption text-muted-foreground">
          Or send them to{" "}
          <span className="selectable font-medium text-foreground">{joinUrlFor(code)}</span>
        </p>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}
