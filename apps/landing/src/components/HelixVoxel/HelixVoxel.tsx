import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

interface HelixVoxelProps {
  /** Canvas width in px. Height = width * 1.25 automatically. Default: 380 */
  width?: number;
  /** Show the Export .glb button. Default: false */
  showExport?: boolean;
}

// ── Voxel Color Palette (Rows y = 0 to 7) ──
// Exactly calibrated against the reference logo gradient:
// Base dark burnt orange -> deep warm orange -> rich orange -> vibrant orange ->
// bright amber -> golden yellow -> warm light yellow -> pale cream-white
const ROW_COLORS: Record<number, { color: string; emissive: string; emissiveIntensity: number }> = {
  0: { color: '#cc4400', emissive: '#882200', emissiveIntensity: 0.25 }, // Base row (inner pillars)
  1: { color: '#ee6018', emissive: '#aa3300', emissiveIntensity: 0.30 }, // Row 1
  2: { color: '#ff5500', emissive: '#bb3b00', emissiveIntensity: 0.35 }, // Row 2 (outer pillars start)
  3: { color: '#ff7a29', emissive: '#cc4e00', emissiveIntensity: 0.40 }, // Row 3 (bridge lower)
  4: { color: '#ff9f1c', emissive: '#dd6800', emissiveIntensity: 0.45 }, // Row 4 (bridge upper)
  5: { color: '#ffb703', emissive: '#ee8800', emissiveIntensity: 0.50 }, // Row 5 (outer pillars end at 6)
  6: { color: '#ffd166', emissive: '#ffa200', emissiveIntensity: 0.55 }, // Row 6
  7: { color: '#fff3b0', emissive: '#ffc83b', emissiveIntensity: 0.60 }, // Row 7 (top inner pillars)
};

// Pure white specular glint material for the accent highlights
const GLINT_MATERIAL_CONFIG = {
  color: '#ffffff',
  emissive: '#ffffff',
  emissiveIntensity: 0.95,
  roughness: 0.1,
  metalness: 0.1,
};

// Check if a coordinate has a specular glint
const isGlintPosition = (x: number, y: number): boolean => {
  // Top of inner-left pillar
  if (x === -1 && y === 7) return true;
  // Top of inner-right pillar
  if (x === 1 && y === 7) return true;
  // Center specular glint on the bridge
  if (x === 0 && y === 4) return true;
  return false;
};

export const HelixVoxel: React.FC<HelixVoxelProps> = ({
  width = 380,
  showExport = false,
}) => {
  const height = Math.round(width * 1.25);
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    // ── Three.js Scene Setup ──
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    // Distance calculated to frame the 7x8 voxel logo with comfortable breathing room
    camera.position.z = 13.5;
    camera.position.y = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    mountRef.current.appendChild(renderer.domElement);

    // ── Voxel Model Group ──
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    // Voxels use BoxGeometry with a very subtle bevel-like scale (0.97) for sharp pixel definition
    const voxelGeometry = new THREE.BoxGeometry(0.97, 0.97, 0.97);

    // Shared glint material
    const glintMaterial = new THREE.MeshStandardMaterial(GLINT_MATERIAL_CONFIG);

    // Cached row materials
    const rowMaterials: Record<number, THREE.MeshStandardMaterial> = {};
    for (let y = 0; y <= 7; y++) {
      const cfg = ROW_COLORS[y];
      rowMaterials[y] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(cfg.color),
        emissive: new THREE.Color(cfg.emissive),
        emissiveIntensity: cfg.emissiveIntensity,
        roughness: 0.25,
        metalness: 0.15,
      });
    }

    // ── Exact Coordinates for the 4-Pillar Helix Voxel Logo ──
    // Grid: width = 7 (x: -3, -1, 0, 1, 3), height = 8 (y: 0 to 7)
    // Vertically centered around y = 3.5 -> mesh y offset = y - 3.5
    const voxelPositions: [number, number][] = [];

    // Outer-left pillar: 5 voxels tall (y = 2 to 6)
    for (let y = 2; y <= 6; y++) {
      voxelPositions.push([-3, y]);
    }

    // Inner-left pillar: 8 voxels tall (y = 0 to 7)
    for (let y = 0; y <= 7; y++) {
      voxelPositions.push([-1, y]);
    }

    // Central bridge: 2 voxels tall (y = 3 to 4) connecting inner pillars
    for (let y = 3; y <= 4; y++) {
      voxelPositions.push([0, y]);
    }

    // Inner-right pillar: 8 voxels tall (y = 0 to 7)
    for (let y = 0; y <= 7; y++) {
      voxelPositions.push([1, y]);
    }

    // Outer-right pillar: 5 voxels tall (y = 2 to 6)
    for (let y = 2; y <= 6; y++) {
      voxelPositions.push([3, y]);
    }

    // Instantiate voxel meshes
    voxelPositions.forEach(([x, y]) => {
      const isGlint = isGlintPosition(x, y);
      const material = isGlint ? glintMaterial : rowMaterials[y];
      const mesh = new THREE.Mesh(voxelGeometry, material);
      // Center the 8-tall grid around y = 0
      mesh.position.set(x, y - 3.5, 0);
      modelGroup.add(mesh);
    });

    // ── Lighting ──
    // Soft ambient light
    const ambientLight = new THREE.AmbientLight(0xffeedd, 0.7);
    scene.add(ambientLight);

    // Warm key light from top-right
    const keyLight = new THREE.DirectionalLight(0xfff3d6, 1.8);
    keyLight.position.set(6, 10, 8);
    scene.add(keyLight);

    // Deep ember rim light from bottom-left to emphasize 3D contours
    const rimLight = new THREE.DirectionalLight(0xff6600, 0.9);
    rimLight.position.set(-6, -4, 5);
    scene.add(rimLight);

    // Soft backlight for depth separation
    const backLight = new THREE.DirectionalLight(0xffa200, 0.6);
    backLight.position.set(0, 4, -6);
    scene.add(backLight);

    // ── Mouse Interaction (Subtle cursor tilt tracking, NO auto-spin) ──
    let targetRotationX = 0;
    let targetRotationY = 0;

    const handleMouseMove = (event: MouseEvent) => {
      // Normalize cursor relative to window center (-1 to 1)
      const normX = (event.clientX / window.innerWidth) * 2 - 1;
      const normY = (event.clientY / window.innerHeight) * 2 - 1;

      // Subtle tilt limits (~21 deg horizontal, ~13 deg vertical)
      targetRotationY = normX * 0.36;
      targetRotationX = -normY * 0.23;
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    // ── Animation Loop with Smooth Damping (Lerp) ──
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);

      // Smooth lerp towards target rotation (smooth follow)
      modelGroup.rotation.x += (targetRotationX - modelGroup.rotation.x) * 0.055;
      modelGroup.rotation.y += (targetRotationY - modelGroup.rotation.y) * 0.055;

      renderer.render(scene, camera);
    };
    animate();

    // ── Cleanup ──
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animId);

      if (mountRef.current && renderer.domElement.parentNode === mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }

      voxelGeometry.dispose();
      glintMaterial.dispose();
      Object.values(rowMaterials).forEach((mat) => mat.dispose());
      renderer.dispose();
    };
  }, [width, height]);

  const handleExport = () => {
    if (!sceneRef.current) return;
    const exporter = new GLTFExporter();
    exporter.parse(
      sceneRef.current,
      (gltf: unknown) => {
        const blob = new Blob([gltf as ArrayBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'helix_logo.glb';
        a.click();
        URL.revokeObjectURL(url);
      },
      (err: unknown) => console.error('GLTFExporter error:', err),
      { binary: true }
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
        userSelect: 'none',
      }}
    >
      {/* 
        ── Ambient Warm Glow ──
        Completely divorced and separated from the 3D rotating model.
        Fixed in the background behind the canvas at z-index 0.
      */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: Math.round(width * 1.35),
          height: Math.round(height * 1.15),
          background:
            'radial-gradient(circle closest-side, rgba(238, 96, 24, 0.32) 0%, rgba(255, 140, 0, 0.16) 45%, rgba(200, 60, 0, 0.04) 75%, transparent 100%)',
          filter: 'blur(36px)',
          borderRadius: '50%',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* ── 3D Canvas Mounting Container ── */}
      <div
        ref={mountRef}
        style={{
          width,
          height,
          position: 'relative',
          zIndex: 1,
          pointerEvents: 'none',
        }}
      />

      {showExport && (
        <button
          onClick={handleExport}
          style={{
            marginTop: 16,
            padding: '10px 24px',
            background: '#382416',
            color: '#ffedd7',
            borderRadius: 9999,
            border: 'none',
            cursor: 'pointer',
            textTransform: 'uppercase',
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: '0.05em',
            position: 'relative',
            zIndex: 2,
          }}
        >
          Export .glb
        </button>
      )}
    </div>
  );
};
