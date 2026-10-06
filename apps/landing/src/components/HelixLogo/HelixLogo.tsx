import React from 'react';
import './HelixLogo.css';

interface HelixLogoProps {
  size?: number | 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
}

export const HelixLogo: React.FC<HelixLogoProps> = ({
  size = 'md',
  showText = true,
  className = ''
}) => {
  const pixelSize = typeof size === 'number' ? size : {
    sm: 22,
    md: 30,
    lg: 44,
    xl: 60
  }[size];

  return (
    <div className={`helix-brand-logo ${className}`}>
      {/* 
        Pixelated geometric 'H' inspired by reference image:
        4 vertical slanted pillars with higher center and negative space / bridge forming 'H'.
        Pixel grid with orange (#ee6018, #ff6b2b, #ff7a29) and yellow (#ffb703, #ffd166, #ff9f1c).
      */}
      <svg
        className="helix-logo-icon"
        width={pixelSize}
        height={pixelSize * (36 / 32)}
        viewBox="0 0 32 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id="pixel-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="1.5" floodColor="#ee6018" floodOpacity="0.4" />
          </filter>
        </defs>

        <g filter="url(#pixel-glow)">
          {/* Pillar 1: Left outer pillar (slanted offset) */}
          <rect x="2" y="10" width="4" height="4" fill="#ffd166" />
          <rect x="2" y="14" width="4" height="4" fill="#ffb703" />
          <rect x="2" y="18" width="4" height="4" fill="#ff9f1c" />
          <rect x="2" y="22" width="4" height="4" fill="#ff6b2b" />
          <rect x="2" y="26" width="4" height="4" fill="#ee6018" />

          {/* Pillar 2: Center-left pillar (tall, spans y=2 to y=34 with bridge) */}
          <rect x="9" y="2" width="4" height="4" fill="#fff3b0" />
          <rect x="9" y="6" width="4" height="4" fill="#ffd166" />
          <rect x="9" y="10" width="4" height="4" fill="#ffb703" />
          <rect x="9" y="14" width="4" height="4" fill="#ff9f1c" />
          {/* Bridge in center connecting both pillars */}
          <rect x="13" y="14" width="6" height="4" fill="#ffd166" />
          <rect x="13" y="18" width="6" height="4" fill="#ffb703" />
          {/* Lower portion */}
          <rect x="9" y="18" width="4" height="4" fill="#ff7a29" />
          <rect x="9" y="22" width="4" height="4" fill="#ff5500" />
          <rect x="9" y="26" width="4" height="4" fill="#ee6018" />
          <rect x="9" y="30" width="4" height="4" fill="#cc4400" />

          {/* Pillar 3: Center-right pillar (tall, spans y=2 to y=34) */}
          <rect x="19" y="2" width="4" height="4" fill="#fff3b0" />
          <rect x="19" y="6" width="4" height="4" fill="#ffd166" />
          <rect x="19" y="10" width="4" height="4" fill="#ffb703" />
          <rect x="19" y="14" width="4" height="4" fill="#ff9f1c" />
          <rect x="19" y="18" width="4" height="4" fill="#ff7a29" />
          <rect x="19" y="22" width="4" height="4" fill="#ff5500" />
          <rect x="19" y="26" width="4" height="4" fill="#ee6018" />
          <rect x="19" y="30" width="4" height="4" fill="#cc4400" />

          {/* Pillar 4: Right outer pillar (slanted offset) */}
          <rect x="26" y="10" width="4" height="4" fill="#ffd166" />
          <rect x="26" y="14" width="4" height="4" fill="#ffb703" />
          <rect x="26" y="18" width="4" height="4" fill="#ff9f1c" />
          <rect x="26" y="22" width="4" height="4" fill="#ff6b2b" />
          <rect x="26" y="26" width="4" height="4" fill="#ee6018" />

          {/* Specular pixel glints */}
          <rect x="9" y="2" width="2" height="2" fill="#ffffff" />
          <rect x="19" y="2" width="2" height="2" fill="#ffffff" />
          <rect x="15" y="14" width="2" height="2" fill="#ffffff" opacity="0.9" />
        </g>
      </svg>

      {showText && (
        <span className="helix-logo-wordmark">
          <span className="wordmark-text">ELIX</span>
        </span>
      )}
    </div>
  );
};
