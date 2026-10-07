import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

interface HelixVoxelProps {
  /** Canvas width in px. Height = width * 1.25 automatically. Default: 400 */
  width?: number;
  /** Show the Export .glb button. Default: false */
  showExport?: boolean;
}

export const HelixVoxel: React.FC<HelixVoxelProps> = ({
  width = 400,
  showExport = false,
}) => {
  const height = Math.round(width * 1.25);
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#100904');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    // Scale camera distance proportionally so the H always fills the frame
    camera.position.z = 12 * (width / 400);
    camera.position.y = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountRef.current.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    const geometry = new THREE.BoxGeometry(1, 1, 1);

    const getMaterialForY = (y: number) => {
      const palette = [
        { color: '#c04000', ei: 0.20 }, // y=0
        { color: '#e05a00', ei: 0.32 }, // y=1
        { color: '#ff7a00', ei: 0.44 }, // y=2
        { color: '#ffa500', ei: 0.56 }, // y=3
        { color: '#ffd966', ei: 0.68 }, // y=4
        { color: '#fffbe0', ei: 0.80 }, // y=5
      ];
      const { color, ei } = palette[Math.min(y, 5)];
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        emissive: new THREE.Color(color),
        emissiveIntensity: ei,
        roughness: 0.2,
        metalness: 0.1,
      });
    };

    // Pixel-H layout
    const positions: [number, number][] = [];
    for (let y = 0; y <= 5; y++) { positions.push([-3, y], [-2, y]); } // left bar
    for (let y = 0; y <= 5; y++) { positions.push([2, y], [3, y]); }   // right bar
    for (let y = 2; y <= 3; y++) { positions.push([-1, y], [0, y], [1, y]); } // crossbar

    positions.forEach(([x, y]) => {
      const mesh = new THREE.Mesh(geometry, getMaterialForY(y));
      mesh.position.set(x, y - 2.5, 0);
      group.add(mesh);
    });

    // Warm top glow light
    const pointLight = new THREE.PointLight('#ffe0a0', 3, 100);
    pointLight.position.set(0, 8, 5);
    scene.add(pointLight);

    scene.add(new THREE.AmbientLight('#402010', 0.5));

    // Soft glow plane behind the H
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 8),
      new THREE.MeshBasicMaterial({
        color: '#ff8800',
        transparent: true,
        opacity: 0.15,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    glow.position.set(0, 0, -1);
    group.add(glow);

    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      group.rotation.y += 0.003;
      group.position.y = Math.sin(Date.now() * 0.001) * 0.1;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      if (mountRef.current && renderer.domElement.parentNode === mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
      geometry.dispose();
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div ref={mountRef} style={{ width, height }} />
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
          }}
        >
          Export .glb
        </button>
      )}
    </div>
  );
};
