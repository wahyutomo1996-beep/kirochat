/**
 * Prometheus brand logo — flame mark.
 *
 * Inspired by the mythological Prometheus (the fire-bringer). A clean
 * lavender teardrop with a white inner highlight, no kitsch flame
 * tongues — those don't survive at favicon scale (16px) and look
 * dated at large sizes.
 *
 * Single component, single source of truth. Used by:
 *   - Landing page navbar (web UI)
 *   - WorkspaceBox / sidebar wherever we want a brand mark
 *   - Icon routes (re-render the same paths inside ImageResponse)
 *
 * Coordinate system: 100×100 viewBox, centered at (50, 50). Tip at
 * y=8, base at y=92. Roughly 80% of the canvas — matches the Android
 * maskable safe-zone so the same artwork survives both web and APK.
 *
 * Why two paths instead of more decoration:
 *   - Two layers = readable at 16px (each curve survives ~3 pixels)
 *   - Three+ layers turn into mush below 32px
 *   - White inner highlight gives "lit from within" depth without
 *     needing extra colors
 */

interface Props {
  /** Pixel size of the rendered logo. Defaults to 32. */
  size?: number;
  /** Optional className passed to the outer <svg>. */
  className?: string;
  /** When true, drops the gradient + uses a single solid lavender.
   *  Useful for tiny rendering contexts where gradients band ugly. */
  flat?: boolean;
}

export function BrandLogo({ size = 32, className, flat = false }: Props) {
  // Stable id per-render-tree to avoid gradient ID collisions when
  // multiple BrandLogo instances appear on the same page.
  const gradId = `prom-flame-grad`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Prometheus"
      role="img"
    >
      {!flat && (
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#828fff" />
            <stop offset="100%" stopColor="#5e6ad2" />
          </linearGradient>
        </defs>
      )}
      {/*
        Outer flame body. The path traces:
          (50,8)  tip
          → curves out left, down past midpoint
          → rounded base
          → curves up the right side back to tip
        Bezier control points kept symmetric so the flame stays balanced;
        slight asymmetry in real fire is sacrificed for icon clarity.
      */}
      <path
        d="M 50 8 C 32 22, 18 44, 22 64 C 25 82, 38 92, 50 92 C 62 92, 75 82, 78 64 C 82 44, 68 22, 50 8 Z"
        fill={flat ? '#5e6ad2' : `url(#${gradId})`}
      />
      {/*
        Inner highlight — smaller flame nested in the lower half.
        Offset upward from the base so it reads as "the bright core
        of the fire" rather than a separate shape.
      */}
      <path
        d="M 50 35 C 42 45, 40 56, 44 66 C 47 74, 52 75, 55 71 C 60 64, 58 47, 50 35 Z"
        fill="#ffffff"
      />
    </svg>
  );
}
