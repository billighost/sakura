"use client";

import React, { useRef, useEffect, useState } from "react";
import { drawWordmark } from "@/lib/brandMark";

interface LyricShareCardProps {
  track: {
    id: string;
    title: string;
    artist: string;
    coverUrl?: string;
  };
  lyric: string;
  accentColor: string | null;
  onClose: () => void;
}

export function LyricShareCard({
  track,
  lyric,
  accentColor,
  onClose,
}: LyricShareCardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sharing, setSharing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas dimensions (classic portrait card, e.g., 1080x1920 for Stories/Share)
    canvas.width = 1080;
    canvas.height = 1920;

    // 1. Draw background gradient with track accent color
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    const colorStart = accentColor || "#F2789F";
    const colorEnd = "#0E0B0F";
    gradient.addColorStop(0, colorStart);
    gradient.addColorStop(0.5, "#1A1620");
    gradient.addColorStop(1, colorEnd);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Load and draw album cover with shadow and rounded corners
    if (track.coverUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        // Draw decorative blurred background cover art
        ctx.save();
        ctx.globalAlpha = 0.15;
        // Blur background cover
        ctx.filter = "blur(40px)";
        ctx.drawImage(img, -100, -100, canvas.width + 200, canvas.height + 200);
        ctx.restore();

        // Draw main album cover card
        const artSize = 640;
        const artX = (canvas.width - artSize) / 2;
        const artY = 220;

        ctx.save();
        // Shadow
        ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
        ctx.shadowBlur = 50;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 20;

        // Rounded corners clip
        ctx.beginPath();
        const radius = 32;
        ctx.moveTo(artX + radius, artY);
        ctx.lineTo(artX + artSize - radius, artY);
        ctx.quadraticCurveTo(artX + artSize, artY, artX + artSize, artY + radius);
        ctx.lineTo(artX + artSize, artY + artSize - radius);
        ctx.quadraticCurveTo(artX + artSize, artY + artSize, artX + artSize - radius, artY + artSize);
        ctx.lineTo(artX + radius, artY + artSize);
        ctx.quadraticCurveTo(artX, artY + artSize, artX, artY + artSize - radius);
        ctx.lineTo(artX, artY + radius);
        ctx.quadraticCurveTo(artX, artY, artX + radius, artY);
        ctx.closePath();
        ctx.clip();

        ctx.drawImage(img, artX, artY, artSize, artSize);
        ctx.restore();

        drawTextOverlay(ctx, artY + artSize + 120);
      };
      img.onerror = () => {
        drawTextOverlay(ctx, 600);
      };
      img.src = track.coverUrl.startsWith("/") || track.coverUrl.startsWith("data:")
        ? track.coverUrl
        : `/api/image-proxy?url=${encodeURIComponent(track.coverUrl)}`;
    } else {
      drawTextOverlay(ctx, 600);
    }

    function drawTextOverlay(ctx: CanvasRenderingContext2D, startY: number) {
      const canvasEl = canvasRef.current;
      if (!canvasEl) return;

      // 3. Draw Track Details
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      // Title
      ctx.font = "800 64px Inter, system-ui, sans-serif";
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(track.title, canvasEl.width / 2, startY);

      // Artist
      ctx.font = "500 42px Inter, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
      ctx.fillText(track.artist, canvasEl.width / 2, startY + 80);

      // Divider line
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(canvasEl.width / 2 - 200, startY + 180);
      ctx.lineTo(canvasEl.width / 2 + 200, startY + 180);
      ctx.stroke();

      // 4. Draw Lyric Quote in center
      ctx.font = "italic 700 56px Fraunces, ui-serif, Georgia, serif";
      ctx.fillStyle = accentColor || "#F2789F";
      
      const maxWidth = 800;
      const words = lyric.split(" ");
      let line = "";
      const lines = [];

      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + " ";
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        if (testWidth > maxWidth && n > 0) {
          lines.push(line);
          line = words[n] + " ";
        } else {
          line = testLine;
        }
      }
      lines.push(line);

      let lyricY = startY + 260;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i].trim(), canvasEl.width / 2, lyricY);
        lyricY += 80;
      }

      // 5. Draw Watermark/Branding at the bottom.
      //
      // Drawn, not typed. This was `ctx.fillText("🌸 SAKURA", ...)`, and an
      // emoji in an exported image is a real problem rather than a cosmetic
      // one: it rasterises to a different picture per platform, so the same
      // card looked like a different product depending on the phone that made
      // it — and rendered a literal empty box anywhere the emoji font was
      // missing, in an image people post publicly.
      drawWordmark(ctx, {
        x: canvasEl.width / 2,
        y: canvasEl.height - 162,
        fontSize: 36,
        color: "rgba(255, 255, 255, 0.42)",
        markColor: accentColor || "#ef6d97",
      });
    }
  }, [track, lyric, accentColor]);

  const handleShare = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setSharing(true);
    setErrorMsg(null);

    try {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          setErrorMsg("Could not render card image.");
          setSharing(false);
          return;
        }

        const file = new File([blob], "sakura-lyric.png", { type: "image/png" });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: `${track.title} Lyric Share`,
              text: `"${lyric}" — ${track.title} by ${track.artist}`,
            });
            onClose();
          } catch (e: any) {
            if (e.name !== "AbortError") {
              fallbackClipboardShare(file);
            } else {
              setSharing(false);
            }
          }
        } else {
          fallbackClipboardShare(file);
        }
      }, "image/png");
    } catch (err: any) {
      setErrorMsg("Share action failed.");
      setSharing(false);
    }
  };

  const fallbackClipboardShare = async (file: File) => {
    try {
      if (typeof window !== "undefined" && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            [file.type]: file,
          }),
        ]);
        alert("Lyric image card copied to clipboard! You can paste and share it now.");
        onClose();
      } else {
        throw new Error();
      }
    } catch {
      setErrorMsg("Web Share API not supported on this browser. Copying/sharing failed.");
      setSharing(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 500,
        background: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(20px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          background: "var(--sakura-surface)",
          border: "1px solid var(--sakura-border)",
          borderRadius: "20px",
          overflow: "hidden",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.5)",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "1.25rem", borderBottom: "1px solid var(--sakura-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>Lyric Share Card</h3>
          <button
            onClick={onClose}
            style={{
              all: "unset",
              cursor: "pointer",
              color: "var(--sakura-text-secondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ padding: "1.5rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <canvas
            ref={canvasRef}
            style={{
              width: "100%",
              aspectRatio: "9/16",
              maxHeight: "480px",
              borderRadius: "12px",
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
              background: "#1A1620",
              objectFit: "contain",
            }}
          />
        </div>

        {errorMsg && (
          <div style={{ padding: "0 1.5rem", color: "var(--sakura-danger)", fontSize: "0.75rem", textAlign: "center" }}>
            {errorMsg}
          </div>
        )}

        <div style={{ padding: "1.25rem", borderTop: "1px solid var(--sakura-border)", display: "flex", gap: "10px" }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              height: "44px",
              borderRadius: "10px",
              border: "1px solid var(--sakura-border)",
              background: "transparent",
              color: "var(--sakura-text)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleShare}
            disabled={sharing}
            style={{
              flex: 2,
              height: "44px",
              borderRadius: "10px",
              border: "none",
              background: accentColor || "var(--sakura-accent)",
              color: "#FFFFFF",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
          >
            {sharing ? "Sharing..." : "Share Card"}
          </button>
        </div>
      </div>
    </div>
  );
}
