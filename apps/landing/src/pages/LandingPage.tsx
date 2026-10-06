import React from 'react';
import { Navigation } from '../components/Navigation/Navigation';
import { Hero } from '../components/Hero/Hero';
import { Features } from '../components/Features/Features';
import { ModelRouter } from '../components/ModelRouter/ModelRouter';
import { Security } from '../components/Security/Security';
import { Download } from '../components/Download/Download';
import { Footer } from '../components/Footer/Footer';

export const LandingPage: React.FC = () => {
  return (
    <div className="landing-page">
      <Navigation />
      <main>
        <Hero />
        <Features />
        <ModelRouter />
        <Security />
        <Download />
      </main>
      <Footer />
    </div>
  );
};
