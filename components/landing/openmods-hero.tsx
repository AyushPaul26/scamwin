import { BACKGROUND_IMAGE, OVERLAY_IMAGE } from "./hero-content";
import { BowlVideo } from "./bowl-video";
import { HeroNavigation } from "./hero-navigation";
import "./hero.css";

export function OpenModsHero() {
  return (
    <main className="openmods-hero font-helvetica-neue" aria-labelledby="openmods-title">
      <div className="hero-grid" aria-hidden="true">
        <svg width="100%" height="100%">
          <defs>
            <pattern id="openmods-grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#64748b" strokeWidth="0.6" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#openmods-grid)" />
        </svg>
      </div>
      <div className="hero-background" style={{ backgroundImage: `url("${BACKGROUND_IMAGE}")` }} aria-hidden="true" />
      <h1 id="openmods-title" className="hero-title">OpenMods</h1>
      {/* The transparent composition must retain its original full-viewport sizing. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="hero-overlay" src={OVERLAY_IMAGE} alt="" draggable={false} />
      <BowlVideo />
      <HeroNavigation />
    </main>
  );
}
