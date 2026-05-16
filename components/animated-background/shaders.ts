export const vertexShaderSource = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

export const fragmentShaderSource = `
  precision mediump float;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform vec3 uColor4;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 3; i++) {
      value += amplitude * noise(p);
      p *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  vec3 blendOverlay(vec3 base, vec3 blend) {
    return vec3(
      base.r < 0.5 ? (2.0 * base.r * blend.r) : (1.0 - 2.0 * (1.0 - base.r) * (1.0 - blend.r)),
      base.g < 0.5 ? (2.0 * base.g * blend.g) : (1.0 - 2.0 * (1.0 - base.g) * (1.0 - blend.g)),
      base.b < 0.5 ? (2.0 * base.b * blend.b) : (1.0 - 2.0 * (1.0 - base.b) * (1.0 - blend.b))
    );
  }

  vec3 blendLinearBurn(vec3 base, vec3 blend) {
    return max(base + blend - vec3(1.0), vec3(0.0));
  }

  float createLen(float time, vec2 coord) {
    float len = length(coord);
    coord.x += cos(coord.y - sin(len)) - cos(time * 0.11);
    coord.y += sin(coord.y + cos(len)) + sin(time * 0.083);
    len = length(coord);
    coord.x += cos(coord.y - sin(len)) - cos(time * 0.11);
    coord.y += sin(coord.y + cos(len)) + sin(time * 0.083);
    return length(coord);
  }

  float createLen2(vec2 coord) {
    float time = u_time * 0.125;
    float len = length(coord);
    float cosLen = cos(len);
    coord.x += sin(coord.y + cosLen * cosLen) + sin(time * 0.1);
    coord.y -= cos(coord.y + sin(len) * sin(len)) + cos(time * 0.1);
    len = length(coord);
    coord.x += sin(coord.y + cos(len) * cos(len)) + sin(time * 0.1);
    coord.y -= cos(coord.y + sin(len) * sin(len)) + cos(time * 0.1);
    return length(coord);
  }

  float createLen3(vec2 coord) {
    float time = (2.0 + u_time * 0.1) * 0.5;
    float len = length(coord);
    coord.y += sin(coord.y + cos(len)) + sin(time);
    len = length(coord);
    coord.y += sin(coord.y + cos(len)) + sin(time);
    return length(coord);
  }

  float createLen4(vec2 coord) {
    float time = (10.0 + u_time * 0.2) * 0.2;
    float len = length(coord);
    coord.x -= cos(coord.y + sin(len)) + cos(time);
    len = length(coord);
    coord.x -= cos(coord.y + sin(len)) + cos(time);
    return length(coord);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 coord = 2.0 * (gl_FragCoord.xy - u_resolution.xy) / min(u_resolution.y, u_resolution.x);

    float len = createLen(u_time * 0.1, coord);
    float len2 = createLen2(coord);
    float len3 = createLen3(coord);
    float len4 = createLen4(coord);

    vec3 blue = uColor1 + cos(len) * 0.25 + 0.25;
    vec3 turquoise = uColor2 + cos(len2) * 0.5 + 0.75;
    vec3 pink = uColor3 + cos(len3) * 0.5 + 0.75;
    vec3 peach = uColor4 + cos(len4) * 0.75 + 0.95;

    float pinkValue = clamp(1.2 - pink.r * 0.833, 0.0, 1.0);
    float peachValue = clamp(1.5 - peach.r * 0.833, 0.0, 1.0);
    float turquoiseValue = clamp(1.5 - turquoise.b * 0.909, 0.0, 1.0);

    vec3 blend = blue;
    blend = mix(blend, turquoise, turquoiseValue);
    blend = mix(blend, peach, peachValue);
    blend = mix(blend, pink, pinkValue);

    vec3 lightercolor = blendLinearBurn(blend, peach);
    blend = mix(blend, lightercolor, max(1.0 - lightercolor.r, 0.0));
    blend = blendOverlay(blend, vec3(0.15, 0.15, 0.15));

    float slowTime = u_time * 0.015;
    vec2 noiseCoord = coord * 1.5 + vec2(slowTime * 0.3, slowTime * 0.2);
    float metalNoise = fbm(noiseCoord);
    vec2 noiseCoord2 = coord * 2.0 - vec2(slowTime * 0.2, slowTime * 0.4);
    float metalNoise2 = fbm(noiseCoord2);
    float combinedNoise = (metalNoise + metalNoise2) * 0.5;

    float shimmer = combinedNoise * 0.12 - 0.06;
    blend += shimmer;

    float iridescenceAngle = atan(coord.y, coord.x) + u_time * 0.008;
    float iridescenceWave = sin(len * 3.0 + iridescenceAngle * 2.0 + combinedNoise * 4.0);
    float iridescenceHue = iridescenceWave * 0.08 + 0.65;
    vec3 iridescence = hsv2rgb(vec3(iridescenceHue, 0.4, 1.0));
    blend = mix(blend, blend * iridescence, 0.15 * smoothstep(0.3, 0.7, combinedNoise));

    float causticTime = u_time * 0.02;
    vec2 causticCoord = coord * 3.0;
    float caustic1 = sin(causticCoord.x * 2.0 + cos(causticCoord.y * 1.5 + causticTime)) *
                     cos(causticCoord.y * 2.0 + sin(causticCoord.x * 1.5 - causticTime));
    float caustic2 = sin(causticCoord.x * 1.7 - causticTime * 1.3) *
                     cos(causticCoord.y * 1.7 + causticTime * 0.7);
    float causticPattern = (caustic1 + caustic2) * 0.5;
    float causticHighlight = pow(max(causticPattern, 0.0), 3.0) * 0.08;
    blend += causticHighlight * vec3(1.0, 0.98, 0.95);

    float highlight = pow(combinedNoise, 2.5) * 0.18;
    vec3 highlightColor = vec3(1.0, 0.92, 0.85);
    blend += highlight * highlightColor;

    float auroraTime = u_time * 0.006;
    float aurora1 = sin(coord.y * 0.8 + coord.x * 0.3 + auroraTime) * 0.5 + 0.5;
    float aurora2 = sin(coord.y * 0.5 - coord.x * 0.4 + auroraTime * 1.3) * 0.5 + 0.5;
    float auroraWave = pow(aurora1 * aurora2, 2.0);
    vec3 auroraColor = hsv2rgb(vec3(0.55 + sin(auroraTime * 0.5) * 0.15, 0.6, 1.0));
    blend += auroraWave * auroraColor * 0.12;

    float candyTime = u_time * 0.01;
    float candyWave = sin(coord.x * 0.5 + coord.y * 0.3 + candyTime) *
                      cos(coord.y * 0.4 - coord.x * 0.2 + candyTime * 0.7);
    candyWave = candyWave * 0.5 + 0.5;
    vec3 cottonPink = vec3(1.0, 0.75, 0.85);
    vec3 cottonBlue = vec3(0.75, 0.85, 1.0);
    vec3 cottonLavender = vec3(0.9, 0.8, 1.0);
    vec3 candyColor = mix(mix(cottonPink, cottonBlue, candyWave),
                          cottonLavender, sin(candyTime * 0.3) * 0.5 + 0.5);
    blend = mix(blend, candyColor, 0.15 * pow(combinedNoise, 0.7));

    float veinNoise = fbm(coord * 4.0 + u_time * 0.008);
    float veins = smoothstep(0.48, 0.52, veinNoise);
    veins *= smoothstep(0.52, 0.48, veinNoise + 0.1);
    vec3 veinColor = vec3(0.08, 0.05, 0.12);
    blend = mix(blend, veinColor, veins * 0.4);

    float mistTime = u_time * 0.005;
    float mist = fbm(coord * 0.8 + vec2(mistTime, mistTime * 0.7));
    mist = pow(mist, 1.5) * 0.12;
    vec3 mistColor = vec3(0.85, 0.8, 0.95);
    blend = mix(blend, mistColor, mist * smoothstep(0.3, 0.6, combinedNoise));

    float curtainTime = u_time * 0.012;
    float curtain1Base = coord.x * 1.8 + sin(coord.y * 0.5) * 0.3;
    float curtain1 = sin(curtain1Base + curtainTime + sin(curtainTime * 0.7) * 0.5);
    curtain1 = pow(max(curtain1, 0.0), 3.0);
    float shimmer1 = sin(coord.y * 8.0 + curtainTime * 3.0) * 0.15 + 0.85;
    curtain1 *= shimmer1;
    float curtain2Base = coord.x * 2.5 - sin(coord.y * 0.7) * 0.2;
    float curtain2 = sin(curtain2Base - curtainTime * 0.7 + 2.0 + sin(curtainTime * 0.5) * 0.4);
    curtain2 = pow(max(curtain2, 0.0), 4.0);
    float shimmer2 = sin(coord.y * 12.0 - curtainTime * 4.0) * 0.12 + 0.88;
    curtain2 *= shimmer2;
    float curtain3Base = coord.x * 4.0 + sin(coord.y * 0.3 + curtainTime * 0.3) * 0.4;
    float curtain3 = sin(curtain3Base + curtainTime * 1.3 + 4.0);
    curtain3 = pow(max(curtain3, 0.0), 5.0);
    float shimmer3 = sin(coord.y * 16.0 + curtainTime * 5.0) * 0.1 + 0.9;
    curtain3 *= shimmer3;
    float curtains = curtain1 * 0.5 + curtain2 * 0.35 + curtain3 * 0.25;
    float curtainFade = smoothstep(-1.5, 1.0, coord.y) * smoothstep(2.0, 0.5, coord.y);
    vec3 curtainColor1 = vec3(1.0, 0.95, 0.92);
    vec3 curtainColor2 = vec3(0.92, 0.95, 1.0);
    vec3 curtainColor = mix(curtainColor1, curtainColor2, sin(curtainTime * 0.5) * 0.5 + 0.5);
    blend += curtains * curtainColor * 0.1 * curtainFade;

    float luminance = dot(blend, vec3(0.299, 0.587, 0.114));
    vec3 warmShift = vec3(1.02, 0.99, 0.96);
    vec3 coolShift = vec3(0.97, 0.99, 1.03);
    blend *= mix(coolShift, warmShift, smoothstep(0.3, 0.7, luminance));

    float edgeDist = length(coord) * 0.5;
    float depthGlow = smoothstep(1.5, 0.5, edgeDist) * 0.08;
    blend += depthGlow * vec3(0.8, 0.7, 1.0);

    float bloomThreshold = smoothstep(0.6, 0.85, luminance);
    vec3 bloomColor = blend * 1.15;
    blend = mix(blend, bloomColor, bloomThreshold * 0.25);

    vec2 vignetteCoord = uv - 0.5;
    float vignette = 1.0 - dot(vignetteCoord, vignetteCoord) * 0.4;
    blend *= vignette;

    float intensity = sin(u_time * 0.015) * sin(u_time * 0.023);
    intensity = intensity * 0.5 + 0.5;
    intensity = pow(intensity, 2.0);
    float contrast = 1.0 + intensity * 0.15;
    blend = pow(blend, vec3(1.0 / contrast));

    float breath = sin(u_time * 0.025) * 0.5 + 0.5;
    breath = pow(breath, 1.5);
    blend *= 0.95 + breath * 0.08;

    float grain = (hash(uv * 500.0 + u_time * 0.1) - 0.5) * 0.015;
    blend += grain;

    blend = mix(blend, blend * 1.08, smoothstep(0.5, 0.8, luminance) * 0.3);
    blend = clamp(blend, 0.0, 1.0);

    gl_FragColor = vec4(blend, 1.0);
  }
`;
