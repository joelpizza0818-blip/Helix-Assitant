import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HelixLogo } from '../components/HelixLogo/HelixLogo';
import { PrivacyModal } from '../components/PrivacyModal/PrivacyModal';
import { getLatestLiteRelease, type LiteReleaseDownload } from '../lib/downloads';
import './ScrollytellingLandingPage.css';

const HERO_VIDEO = new URL('../Multimedia/video 1 - helix.mp4', import.meta.url).href;
const VOICE_VIDEO = new URL('../Multimedia/video 2 - helix.mp4', import.meta.url).href;
const SKILLS_VIDEO = new URL('../Multimedia/video 3 -helix.mp4', import.meta.url).href;
const CHAT_VIDEO = new URL('../Multimedia/video 4 - helix.mp4', import.meta.url).href;
const CLI_VIDEO_1 = new URL('../Multimedia/helix cli 1.mp4', import.meta.url).href;
const CLI_VIDEO_2 = new URL('../Multimedia/helix cli 2.mp4', import.meta.url).href;
const CLI_VIDEO_3 = new URL('../Multimedia/helix cli 3.mp4', import.meta.url).href;

const HERO_POSTER = new URL('../Multimedia/poster-1.jpg', import.meta.url).href;
const VOICE_POSTER = new URL('../Multimedia/poster-2.jpg', import.meta.url).href;
const SKILLS_POSTER = new URL('../Multimedia/poster-3.jpg', import.meta.url).href;
const CHAT_POSTER = new URL('../Multimedia/poster-4.jpg', import.meta.url).href;
const CLI_POSTER_1 = new URL('../Multimedia/poster-cli-1.jpg', import.meta.url).href;
const CLI_POSTER_2 = new URL('../Multimedia/poster-cli-2.jpg', import.meta.url).href;
const CLI_POSTER_3 = new URL('../Multimedia/poster-cli-3.jpg', import.meta.url).href;
const CARD_1_IMAGE = new URL('../Multimedia/card-1-chat.png', import.meta.url).href;
const CARD_CLI_IMAGE = new URL('../Multimedia/helix-cli-card.png', import.meta.url).href;

type DemoVideoProps = {
  src: string;
  poster: string;
  label: string;
  preload?: 'none' | 'metadata';
};

function DemoVideo({ src, poster, label, preload = 'none' }: DemoVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof IntersectionObserver === 'undefined') return;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !reduceMotion) {
          void video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      },
      { threshold: 0.35 },
    );

    observer.observe(video);
    return () => {
      observer.disconnect();
      video.pause();
    };
  }, []);

  return (
    <video
      ref={videoRef}
      className="scrolly-video"
      src={src}
      poster={poster}
      aria-label={label}
      muted
      loop
      playsInline
      preload={preload}
    />
  );
}

type GalleryTrackProps = {
  sectionRef: React.RefObject<HTMLElement>;
};

function VideoGallery({ sectionRef }: GalleryTrackProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [travel, setTravel] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const track = trackRef.current;
    if (!section || !stage || !track) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const verticalTravel = Math.max(0, section.offsetHeight - window.innerHeight);
      const scrolled = Math.min(verticalTravel, Math.max(0, -section.getBoundingClientRect().top));
      setProgress(verticalTravel === 0 ? 0 : scrolled / verticalTravel);
      setTravel(Math.max(0, track.scrollWidth - stage.clientWidth));
    };
    const scheduleUpdate = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };

    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(stage);
    resizeObserver?.observe(track);
    scheduleUpdate();

    return () => {
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      resizeObserver?.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [sectionRef]);

  return (
    <div className="scrolly-gallery__stage" ref={stageRef}>
      <div className="scrolly-gallery__heading">
        <p className="scrolly-eyebrow">A closer look</p>
        <h2>See HELIX at work.</h2>
        <p>Scroll to move through the desktop, settings, and skills that bring HELIX to life.</p>
      </div>

      <div className="scrolly-gallery__viewport" role="region" aria-label="HELIX video gallery">
        <div
          className="scrolly-gallery__track"
          ref={trackRef}
          style={{ transform: `translate3d(${-progress * travel}px, 0, 0)` }}
        >
          <article className="scrolly-gallery-card">
            <div className="scrolly-browser-frame">
              <div className="scrolly-browser-frame__bar">
                <span className="scrolly-window-dots" aria-hidden="true"><i /><i /><i /></span>
                <span>HELIX / VOICE &amp; CALLS</span>
                <span className="scrolly-browser-frame__status">PREVIEW</span>
              </div>
              <DemoVideo src={VOICE_VIDEO} poster={VOICE_POSTER} label="HELIX voice and calls settings preview" />
            </div>
            <div className="scrolly-gallery-card__caption">
              <span>02 / VOICE &amp; CALLS</span>
              <h3>Make the desktop feel natural.</h3>
              <p>Set up voice input and tune how HELIX responds on your machine.</p>
            </div>
          </article>

          <article className="scrolly-gallery-card">
            <div className="scrolly-browser-frame">
              <div className="scrolly-browser-frame__bar">
                <span className="scrolly-window-dots" aria-hidden="true"><i /><i /><i /></span>
                <span>HELIX / SKILLS</span>
                <span className="scrolly-browser-frame__status">PREVIEW</span>
              </div>
              <DemoVideo src={SKILLS_VIDEO} poster={SKILLS_POSTER} label="HELIX skills editor preview" />
            </div>
            <div className="scrolly-gallery-card__caption">
              <span>03 / SKILLS</span>
              <h3>Give recurring work a shape.</h3>
              <p>Create reusable instructions for the work you want HELIX to recognize.</p>
            </div>
          </article>

          <article className="scrolly-gallery-card">
            <div className="scrolly-browser-frame">
              <div className="scrolly-browser-frame__bar">
                <span className="scrolly-window-dots" aria-hidden="true"><i /><i /><i /></span>
                <span>HELIX / DESKTOP AGENT</span>
                <span className="scrolly-browser-frame__status">PREVIEW</span>
              </div>
              <DemoVideo src={CHAT_VIDEO} poster={CHAT_POSTER} label="HELIX desktop agent conversation preview" />
            </div>
            <div className="scrolly-gallery-card__caption">
              <span>04 / CONVERSATION</span>
              <h3>Let a conversation lead to action.</h3>
              <p>Bring voice, skills, and desktop tools into one continuous flow.</p>
            </div>
          </article>

          <article className="scrolly-gallery-card">
            <div className="scrolly-browser-frame">
              <div className="scrolly-browser-frame__bar">
                <span className="scrolly-window-dots" aria-hidden="true"><i /><i /><i /></span>
                <span>HELIX CLI / CONNECTION</span>
                <span className="scrolly-browser-frame__status">CLI PREVIEW</span>
              </div>
              <DemoVideo src={CLI_VIDEO_1} poster={CLI_POSTER_1} label="HELIX CLI startup and connection flow" />
            </div>
            <div className="scrolly-gallery-card__caption">
              <span>05 / CLI CONNECTION</span>
              <h3>Connect from your terminal.</h3>
              <p>The HELIX CLI can connect to the local agent over WebSocket.</p>
            </div>
          </article>

          <article className="scrolly-gallery-card">
            <div className="scrolly-browser-frame">
              <div className="scrolly-browser-frame__bar">
                <span className="scrolly-window-dots" aria-hidden="true"><i /><i /><i /></span>
                <span>HELIX CLI / REASONING</span>
                <span className="scrolly-browser-frame__status">CLI PREVIEW</span>
              </div>
              <DemoVideo src={CLI_VIDEO_2} poster={CLI_POSTER_2} label="HELIX CLI reasoning and prompt flow" />
            </div>
            <div className="scrolly-gallery-card__caption">
              <span>06 / CLI WORKFLOWS</span>
              <h3>CLI workflows in your shell.</h3>
              <p>Use the terminal REPL with autocompletion for skills, MCP tools, and slash commands.</p>
            </div>
          </article>

          <article className="scrolly-gallery-card">
            <div className="scrolly-browser-frame">
              <div className="scrolly-browser-frame__bar">
                <span className="scrolly-window-dots" aria-hidden="true"><i /><i /><i /></span>
                <span>HELIX CLI / TASK EXECUTION</span>
                <span className="scrolly-browser-frame__status">CLI PREVIEW</span>
              </div>
              <DemoVideo src={CLI_VIDEO_3} poster={CLI_POSTER_3} label="HELIX CLI task execution preview" />
            </div>
            <div className="scrolly-gallery-card__caption">
              <span>07 / CLI TOOL EXECUTION</span>
              <h3>Run supported tasks from your terminal.</h3>
              <p>Use HELIX commands and agent tools from the CLI.</p>
            </div>
          </article>
        </div>
      </div>

      <div className="scrolly-gallery__progress" aria-hidden="true">
        <span>02</span>
        <span className="scrolly-gallery__progress-track"><i style={{ width: `${Math.max(4, progress * 100)}%` }} /></span>
        <span>07</span>
      </div>
    </div>
  );
}

type StoriesStackProps = {
  sectionRef: React.RefObject<HTMLElement>;
};

function StoriesStack({ sectionRef }: StoriesStackProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const verticalTravel = Math.max(1, section.offsetHeight - window.innerHeight);
      const scrolled = Math.min(verticalTravel, Math.max(0, -section.getBoundingClientRect().top));
      setProgress(scrolled / verticalTravel);
    };
    const scheduleUpdate = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };

    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    scheduleUpdate();

    return () => {
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [sectionRef]);

  // 4 cards stack: Card 2 covers Card 1, Card 3 covers Card 2, Card 4 covers Card 3
  const t2 = Math.min(1, Math.max(0, (progress - 0.03) / 0.28));
  const card2Y = (1 - t2) * 105;

  const t3 = Math.min(1, Math.max(0, (progress - 0.35) / 0.28));
  const card3Y = (1 - t3) * 105;

  const t4 = Math.min(1, Math.max(0, (progress - 0.67) / 0.28));
  const card4Y = (1 - t4) * 105;

  return (
    <div className="scrolly-stories__stage">
      <div className="scrolly-section-heading">
        <p className="scrolly-eyebrow">More than a chat window</p>
        <h2 id="scrolly-stories-title">Made for the flow of your desktop.</h2>
        <p>Stay in one conversation as you move between what you see, what you say, and what you need done.</p>
      </div>

      <div className="scrolly-stack-viewport" role="region" aria-label="HELIX interactive desktop stories">
        <div className="scrolly-stack-layer" style={{ zIndex: 1 }}>
          <article className="scrolly-stack-card scrolly-stack-card--context">
            <div className="scrolly-stack-card__copy">
              <span className="scrolly-stack-card__number">01 / SCREEN CONTEXT</span>
              <h3>Bring your screen into the conversation.</h3>
              <p>When you ask, HELIX can use screen capture and OCR to help make sense of the work already in view.</p>
              <span className="scrolly-pill">Context, when you need it</span>
            </div>
            <div className="scrolly-illustration scrolly-illustration--context" aria-hidden="true">
              <div className="scrolly-card-image-wrap">
                <img
                  src={CARD_1_IMAGE}
                  alt="HELIX active conversation preview"
                  className="scrolly-card-image"
                />
              </div>
            </div>
          </article>
        </div>

        <div
          className="scrolly-stack-layer"
          style={{
            zIndex: 2,
            transform: `translate3d(0, ${card2Y}%, 0)`,
          }}
        >
          <article className="scrolly-stack-card scrolly-stack-card--cli">
            <div className="scrolly-stack-card__copy">
              <span className="scrolly-stack-card__number">02 / CLI &amp; TERMINAL</span>
              <h3>Use HELIX from your terminal.</h3>
              <p>The CLI can connect to the local agent. Available commands and tools depend on configuration.</p>
              <span className="scrolly-pill">CLI · Local agent · Configurable tools</span>
            </div>
            <div className="scrolly-illustration scrolly-illustration--cli" aria-hidden="true">
              <div className="scrolly-card-image-wrap">
                <img
                  src={CARD_CLI_IMAGE}
                  alt="HELIX interactive CLI terminal interface"
                  className="scrolly-card-image"
                />
              </div>
            </div>
          </article>
        </div>

        <div
          className="scrolly-stack-layer"
          style={{
            zIndex: 3,
            transform: `translate3d(0, ${card3Y}%, 0)`,
          }}
        >
          <article className="scrolly-stack-card scrolly-stack-card--voice">
            <div className="scrolly-stack-card__copy">
              <span className="scrolly-stack-card__number">03 / VOICE &amp; TASKS</span>
              <h3>Talk naturally. Keep the work moving.</h3>
              <p>Start with voice, then follow a task as it runs. HELIX brings the conversation and task manager into your desktop workflow.</p>
              <span className="scrolly-pill">Voice · Tasks · Control</span>
            </div>
            <div className="scrolly-illustration scrolly-illustration--voice" aria-hidden="true">
              <div className="scrolly-voice-panel">
                <span className="scrolly-voice-panel__label">HELIX IS LISTENING</span>
                <div className="scrolly-waveform">{Array.from({ length: 31 }, (_, index) => <i key={index} />)}</div>
                <p>“Help me get started.”</p>
                <span className="scrolly-voice-panel__state"><i /> Ready for your next request</span>
              </div>
            </div>
          </article>
        </div>

        <div
          className="scrolly-stack-layer"
          style={{
            zIndex: 4,
            transform: `translate3d(0, ${card4Y}%, 0)`,
          }}
        >
          <article className="scrolly-stack-card scrolly-stack-card--control">
            <div className="scrolly-stack-card__copy">
              <span className="scrolly-stack-card__number">04 / YOUR BOUNDARIES</span>
              <h3>Keep your tools in your hands.</h3>
              <p>HELIX uses configured providers. Confirmation requirements vary by tool and action.</p>
              <span className="scrolly-pill">Configured by you · Confirmed by you</span>
            </div>
            <div className="scrolly-illustration scrolly-illustration--control" aria-hidden="true">
              <div className="scrolly-control-panel">
                <div className="scrolly-control-panel__heading">
                  <span>CONTROL CENTER</span>
                  <b>
                    <svg viewBox="0 0 16 16" width="7" height="7" fill="currentColor" style={{ marginRight: 5 }}>
                      <circle cx="8" cy="8" r="6" />
                    </svg>
                    Active
                  </b>
                </div>
                <div className="scrolly-control-row"><span>Model providers</span><b>Configured only</b></div>
                <div className="scrolly-control-row"><span>Computer tools</span><b>Policy checked</b></div>
                <div className="scrolly-control-row"><span>Important changes</span><b>Needs your approval</b></div>
                <div className="scrolly-control-panel__footer">
                  <span>YOU STAY IN CONTROL</span>
                  <i>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </i>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}

export const ScrollytellingLandingPage: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [liteRelease, setLiteRelease] = useState<LiteReleaseDownload | null>(null);
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false);
  const [targetEdition, setTargetEdition] = useState<'Normal' | 'Lite'>('Normal');
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const navigate = useNavigate();

  const storiesRef = useRef<HTMLElement>(null);
  const galleryRef = useRef<HTMLElement>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    getLatestLiteRelease(controller.signal)
      .then(setLiteRelease)
      .catch(() => {
        // Fallback gracefully if endpoint unavailable
      });
    return () => controller.abort();
  }, []);

  const triggerDownloadAction = (edition: 'Normal' | 'Lite') => {
    const isAccepted = typeof window !== 'undefined' && localStorage.getItem('helix_privacy_accepted') === 'true';
    const execute = () => {
      if (edition === 'Normal') {
        navigate('/download');
      } else {
        if (liteRelease?.installerUrl) {
          window.location.assign(liteRelease.installerUrl);
        } else {
          navigate('/download');
        }
      }
    };

    if (isAccepted) {
      execute();
    } else {
      setTargetEdition(edition);
      setPendingAction(() => execute);
      setPrivacyModalOpen(true);
    }
  };

  const handleModalConfirm = () => {
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const focusableItems = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('a[href]') ?? []);
    const firstItem = focusableItems[0];
    const lastItem = focusableItems[focusableItems.length - 1];
    const handleMenuKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        return;
      }

      if (event.key === 'Tab' && focusableItems.length > 0) {
        const activeItem = document.activeElement;
        if (event.shiftKey && (activeItem === firstItem || !menuRef.current?.contains(activeItem))) {
          event.preventDefault();
          lastItem?.focus();
        } else if (!event.shiftKey && (activeItem === lastItem || !menuRef.current?.contains(activeItem))) {
          event.preventDefault();
          firstItem?.focus();
        }
      }
    };

    document.body.style.overflow = 'hidden';
    firstItem?.focus();
    window.addEventListener('keydown', handleMenuKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleMenuKeys);
      menuToggleRef.current?.focus();
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="scrolly-page" id="top">
      <header className="scrolly-header">
        <a href="#top" className="scrolly-header__brand" aria-label="HELIX landing, back to top">
          <HelixLogo size="sm" showText />
        </a>
        <button
          ref={menuToggleRef}
          type="button"
          className={`scrolly-menu-toggle${menuOpen ? ' is-open' : ''}`}
          aria-expanded={menuOpen}
          aria-controls="scrolly-menu"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span /><span /><span />
        </button>
      </header>

      <nav ref={menuRef} id="scrolly-menu" className={`scrolly-menu${menuOpen ? ' is-open' : ''}`} aria-label="Main navigation" aria-hidden={!menuOpen}>
        <div className="scrolly-menu__inner">
          <p className="scrolly-eyebrow">Navigate HELIX</p>
          <Link to="/download" onClick={closeMenu}>Download <span>01</span></Link>
          <a href="#story" onClick={closeMenu}>The experience <span>02</span></a>
          <a href="#showcase" onClick={closeMenu}>See HELIX at work <span>03</span></a>
          <Link to="/features" onClick={closeMenu}>What's New <span>04</span></Link>
          <Link to="/docs" onClick={closeMenu}>Documentation <span>05</span></Link>
          <Link to="/privacy" onClick={closeMenu}>Privacy Policy <span>06</span></Link>
          <div className="scrolly-menu__account">
            <Link to="/login" onClick={closeMenu}>Log in</Link>
            <Link to="/register" onClick={closeMenu}>Create an account</Link>
            <button
              type="button"
              className="scrolly-menu-btn"
              onClick={() => { closeMenu(); triggerDownloadAction('Normal'); }}
            >
              Download HELIX Normal
            </button>
            <button
              type="button"
              className="scrolly-menu-btn"
              onClick={() => { closeMenu(); triggerDownloadAction('Lite'); }}
            >
              Download HELIX Lite
            </button>
          </div>
          <p className="scrolly-menu__note">A Windows desktop agent with optional voice and screen context.</p>
        </div>
      </nav>

      <main>
        <section className="scrolly-hero" aria-labelledby="scrolly-hero-title">
          <div className="scrolly-hero__copy">
            <p className="scrolly-eyebrow">Windows desktop agent · installers for Windows x64</p>
            <h1 id="scrolly-hero-title">An AI that works<br /><span>where you do.</span></h1>
            <p className="scrolly-hero__description">
              HELIX brings conversation and desktop tools together, with optional voice and screen context.
            </p>
            <div className="scrolly-actions">
              <button
                type="button"
                className="scrolly-button scrolly-button--primary"
                onClick={() => triggerDownloadAction('Normal')}
              >
                Download HELIX Normal (Electron)
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="7" y1="17" x2="17" y2="7" />
                  <polyline points="7 7 17 7 17 17" />
                </svg>
              </button>
              <button
                type="button"
                className="scrolly-button scrolly-button--lite"
                onClick={() => triggerDownloadAction('Lite')}
              >
                Download HELIX Lite (Tauri Edition)
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </button>
              <a href="#story" className="scrolly-button scrolly-button--quiet">
                Explore
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <polyline points="19 12 12 19 5 12" />
                </svg>
              </a>
            </div>

            <div className="scrolly-editions-strip">
              <div className="scrolly-edition-chip">
                <span className="scrolly-edition-chip__badge">NORMAL</span>
                <span><strong>Electron</strong> · System Tray · Desktop tools & OCR</span>
              </div>
              <div className="scrolly-edition-chip">
                <span className="scrolly-edition-chip__badge scrolly-edition-chip__badge--lite">LITE</span>
                <span><strong>Tauri + Rust</strong> · Windows x64 installer · RAM not benchmarked</span>
              </div>
            </div>
          </div>

          <div className="scrolly-browser-frame scrolly-hero__frame">
            <div className="scrolly-browser-frame__bar">
              <span className="scrolly-window-dots" aria-hidden="true"><i /><i /><i /></span>
              <span>HELIX / DESKTOP PREVIEW</span>
              <span className="scrolly-browser-frame__status">VIDEO PREVIEW</span>
            </div>
            <DemoVideo src={HERO_VIDEO} poster={HERO_POSTER} label="HELIX desktop conversation preview" preload="metadata" />
          </div>
          <div className="scrolly-hero__footnote">
            <span>01 — A desktop-native assistant</span>
            <a href="#story">
              Scroll to explore
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 6 }}>
                <line x1="12" y1="5" x2="12" y2="19" />
                <polyline points="19 12 12 19 5 12" />
              </svg>
            </a>
          </div>
        </section>

        <section className="scrolly-stories" id="story" ref={storiesRef} aria-labelledby="scrolly-stories-title">
          <StoriesStack sectionRef={storiesRef} />
        </section>

        <section className="scrolly-gallery" id="showcase" ref={galleryRef} aria-label="HELIX video showcase">
          <VideoGallery sectionRef={galleryRef} />
        </section>

        <section className="scrolly-endcap" aria-labelledby="scrolly-endcap-title">
          <p className="scrolly-eyebrow">Make room for more</p>
          <h2 id="scrolly-endcap-title">Let HELIX meet you at your desktop.</h2>
          <p>Get to know the tools, shape your setup, and choose what belongs in your workflow.</p>
          <div className="scrolly-actions">
            <button
              type="button"
              className="scrolly-button scrolly-button--primary"
              onClick={() => triggerDownloadAction('Normal')}
            >
              Download HELIX Normal
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </button>
            <button
              type="button"
              className="scrolly-button scrolly-button--lite"
              onClick={() => triggerDownloadAction('Lite')}
            >
              Download HELIX Lite
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </button>
            <Link to="/register" className="scrolly-button scrolly-button--quiet">
              Create an account
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </Link>
          </div>
        </section>
      </main>

      <footer className="scrolly-footer">
        <div className="scrolly-footer__top">
          <div className="scrolly-footer__brand">
            <a href="#top" aria-label="Back to top"><HelixLogo size="sm" showText /></a>
            <p>A Windows desktop agent with optional voice and screen context.</p>
          </div>
          <div className="scrolly-footer__links">
            <div>
              <span>EXPLORE</span>
              <a href="#story">The experience</a>
              <a href="#showcase">Video showcase</a>
              <Link to="/features">What's New</Link>
              <Link to="/docs">Documentation</Link>
            </div>
            <div>
              <span>YOUR HELIX</span>
              <Link to="/login">Log in</Link>
              <Link to="/register">Create an account</Link>
              <Link to="/download">Download Builds</Link>
              <Link to="/privacy">Privacy Policy</Link>
            </div>
          </div>
        </div>
        <div className="scrolly-footer__bottom">
          <span>© {new Date().getFullYear()} HELIX Project · Local agent · Configured providers</span>
          <a href="#top">
            Back to top
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 6 }}>
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </a>
        </div>
      </footer>

      <PrivacyModal
        isOpen={privacyModalOpen}
        targetEdition={targetEdition}
        onClose={() => setPrivacyModalOpen(false)}
        onConfirm={handleModalConfirm}
      />
    </div>
  );
};
