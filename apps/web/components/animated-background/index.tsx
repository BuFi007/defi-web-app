"use client";

import { memo, useEffect, useRef } from "react";
import { vertexShaderSource, fragmentShaderSource } from "./shaders";

const hex2rgb = (hex: string): [number, number, number] => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r / 255, g / 255, b / 255];
};

const COLOR_PRESETS = {
  default: ["#225ee1", "#28d7bf", "#ac53cf", "#e7a39c"],
  bufi: ["#6954CF", "#8B7DD8", "#A78BFA", "#D8C2FF"],
  vibrant: ["#A78BFA", "#6954CF", "#C4B5FD", "#8B7DD8"],
  subtle: ["#EDE9FE", "#D8C2FF", "#8B7DD8", "#F3E8FF"],
  dark: ["#4C3D99", "#5B4BA8", "#7C6BBF", "#6954CF"],
  celebration: ["#A78BFA", "#F472B6", "#60A5FA", "#34D399"],
  premium: ["#8B5CF6", "#6366F1", "#A855F7", "#7C3AED"],
  pink: ["#E879F9", "#F0ABFC", "#D8C2FF", "#D946EF"],
} as const;

type ColorPreset = keyof typeof COLOR_PRESETS;

interface AnimatedBackgroundProps {
  className?: string;
  isMac?: boolean;
  variant?: ColorPreset;
}

const AnimatedBackground = ({
  className = "",
  isMac = false,
  variant = "default",
}: AnimatedBackgroundProps) => {
  const RESOLUTION_SCALE = isMac ? 0.5 : 0.35;
  const TARGET_FPS = isMac ? 30 : 24;
  const FRAME_INTERVAL = 1000 / TARGET_FPS;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Precomputed so the CSS gradient fallback on <canvas> can use it without
  // waiting for the WebGL init effect to run.
  const selectedColors = COLOR_PRESETS[variant] || COLOR_PRESETS.default;
  const cssGradient = `linear-gradient(135deg, ${selectedColors[0]} 0%, ${selectedColors[1]} 35%, ${selectedColors[2]} 65%, ${selectedColors[3]} 100%)`;

  useEffect(() => {
    const colorValues = selectedColors.map(hex2rgb) as [
      number,
      number,
      number,
    ][];

    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl =
      canvas.getContext("webgl") ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext);
    if (!gl) {
      // Headless / GPU-disabled / WebGL-blocked: leave the canvas transparent
      // so the CSS gradient on the element shows through. Was painting a
      // solid first-color rect, which looked awful (e.g. #225ee1 slab).
      return;
    }

    if (gl.isContextLost()) return;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) return;

    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(vertexShader);
    gl.compileShader(fragmentShader);

    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      console.error("[AnimatedBackground] vertex", gl.getShaderInfoLog(vertexShader));
      return;
    }
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      console.error("[AnimatedBackground] fragment", gl.getShaderInfoLog(fragmentShader));
      return;
    }

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("[AnimatedBackground] link", gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.disable(gl.DITHER);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const positionAttributeLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

    const timeUniformLocation = gl.getUniformLocation(program, "u_time");
    const resolutionUniformLocation = gl.getUniformLocation(program, "u_resolution");
    const color1UniformLocation = gl.getUniformLocation(program, "uColor1");
    const color2UniformLocation = gl.getUniformLocation(program, "uColor2");
    const color3UniformLocation = gl.getUniformLocation(program, "uColor3");
    const color4UniformLocation = gl.getUniformLocation(program, "uColor4");

    const [c1, c2, c3, c4] = colorValues;
    gl.uniform3f(color1UniformLocation, c1![0], c1![1], c1![2]);
    gl.uniform3f(color2UniformLocation, c2![0], c2![1], c2![2]);
    gl.uniform3f(color3UniformLocation, c3![0], c3![1], c3![2]);
    gl.uniform3f(color4UniformLocation, c4![0], c4![1], c4![2]);

    const TIME_SCALE = 1.0 / 100.0;
    const startTime = performance.now();
    let animationFrameId: number | null = null;
    let lastFrameTime = 0;
    let isVisible = true;
    let lastResizeCheck = 0;
    const RESIZE_CHECK_INTERVAL = 250;
    const MAX_CANVAS_PIXELS = 480 * 270;

    const updateCanvasSize = () => {
      const rect = canvas.getBoundingClientRect();
      let scaledWidth = Math.floor(rect.width * RESOLUTION_SCALE);
      let scaledHeight = Math.floor(rect.height * RESOLUTION_SCALE);
      const pixels = scaledWidth * scaledHeight;
      if (pixels > MAX_CANVAS_PIXELS) {
        const ratio = Math.sqrt(MAX_CANVAS_PIXELS / pixels);
        scaledWidth = Math.floor(scaledWidth * ratio);
        scaledHeight = Math.floor(scaledHeight * ratio);
      }
      if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
        canvas.width = scaledWidth;
        canvas.height = scaledHeight;
        gl.viewport(0, 0, scaledWidth, scaledHeight);
      }
      return { width: scaledWidth, height: scaledHeight };
    };

    let { width: cachedWidth, height: cachedHeight } = updateCanvasSize();

    const glClear = gl.clear.bind(gl);
    const glUniform1f = gl.uniform1f.bind(gl);
    const glUniform2f = gl.uniform2f.bind(gl);
    const glDrawArrays = gl.drawArrays.bind(gl);

    const handleVisibilityChange = () => {
      isVisible = document.visibilityState === "visible";
      if (isVisible && animationFrameId === null) {
        lastFrameTime = performance.now();
        animationFrameId = requestAnimationFrame(animate);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const animate = (timestamp: number) => {
      if (!isVisible) {
        animationFrameId = null;
        return;
      }
      const deltaTime = timestamp - lastFrameTime;
      if (deltaTime < FRAME_INTERVAL) {
        animationFrameId = requestAnimationFrame(animate);
        return;
      }
      lastFrameTime = timestamp - (deltaTime % FRAME_INTERVAL);
      if (timestamp - lastResizeCheck > RESIZE_CHECK_INTERVAL) {
        const { width, height } = updateCanvasSize();
        cachedWidth = width;
        cachedHeight = height;
        lastResizeCheck = timestamp;
      }
      const elapsedTime = (timestamp - startTime) * TIME_SCALE;
      glClear(gl.COLOR_BUFFER_BIT);
      glUniform1f(timeUniformLocation, elapsedTime);
      glUniform2f(resolutionUniformLocation, cachedWidth, cachedHeight);
      glDrawArrays(gl.TRIANGLE_STRIP, 0, 4);
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
      if (program) gl.deleteProgram(program);
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
    };
  }, [isMac, variant, FRAME_INTERVAL, RESOLUTION_SCALE, selectedColors]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        imageRendering: "auto",
        background: cssGradient,
      }}
    />
  );
};

export default memo(AnimatedBackground);
export { COLOR_PRESETS, type ColorPreset };
