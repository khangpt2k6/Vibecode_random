/**
 * Shader program wrapper.
 *
 * Compiles, links, and caches uniform locations. Uniform setters skip the GL
 * call when the value has not changed, because `gl.uniform*` is one of the
 * few calls in this renderer made often enough for the redundancy check to
 * pay for itself.
 */

export class ShaderError extends Error {
  constructor(
    message: string,
    readonly stage: 'vertex' | 'fragment' | 'link',
    readonly log: string,
    readonly source?: string,
  ) {
    super(message);
    this.name = 'ShaderError';
  }
}

export class Shader {
  readonly program: WebGLProgram;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private readonly cache = new Map<string, number | Float32Array | number[]>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string,
    readonly name = 'shader',
  ) {
    const vs = compile(gl, gl.VERTEX_SHADER, vertexSource, 'vertex');
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource, 'fragment');

    const program = gl.createProgram();
    if (!program) throw new ShaderError('createProgram returned null', 'link', '');

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    // Shader objects are refcounted by the program; drop our reference now so
    // they are freed as soon as the program is.
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? '(no log)';
      gl.deleteProgram(program);
      throw new ShaderError(`Failed to link ${name}: ${log}`, 'link', log);
    }

    this.program = program;
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  attribLocation(attrib: string): number {
    return this.gl.getAttribLocation(this.program, attrib);
  }

  private loc(name: string): WebGLUniformLocation | null {
    if (this.uniforms.has(name)) return this.uniforms.get(name)!;
    const l = this.gl.getUniformLocation(this.program, name);
    this.uniforms.set(name, l);
    return l;
  }

  setFloat(name: string, v: number): void {
    if (this.cache.get(name) === v) return;
    const l = this.loc(name);
    if (!l) return;
    this.gl.uniform1f(l, v);
    this.cache.set(name, v);
  }

  setInt(name: string, v: number): void {
    if (this.cache.get(name) === v) return;
    const l = this.loc(name);
    if (!l) return;
    this.gl.uniform1i(l, v);
    this.cache.set(name, v);
  }

  setVec2(name: string, x: number, y: number): void {
    const prev = this.cache.get(name) as number[] | undefined;
    if (prev && prev[0] === x && prev[1] === y) return;
    const l = this.loc(name);
    if (!l) return;
    this.gl.uniform2f(l, x, y);
    this.cache.set(name, [x, y]);
  }

  setVec3(name: string, x: number, y: number, z: number): void {
    const prev = this.cache.get(name) as number[] | undefined;
    if (prev && prev[0] === x && prev[1] === y && prev[2] === z) return;
    const l = this.loc(name);
    if (!l) return;
    this.gl.uniform3f(l, x, y, z);
    this.cache.set(name, [x, y, z]);
  }

  setVec4(name: string, x: number, y: number, z: number, w: number): void {
    const prev = this.cache.get(name) as number[] | undefined;
    if (prev && prev[0] === x && prev[1] === y && prev[2] === z && prev[3] === w) return;
    const l = this.loc(name);
    if (!l) return;
    this.gl.uniform4f(l, x, y, z, w);
    this.cache.set(name, [x, y, z, w]);
  }

  /** Matrices are uploaded unconditionally - the compare would cost as much. */
  setMat3(name: string, m: Float32Array): void {
    const l = this.loc(name);
    if (!l) return;
    this.gl.uniformMatrix3fv(l, false, m);
  }

  setMat4(name: string, m: Float32Array): void {
    const l = this.loc(name);
    if (!l) return;
    this.gl.uniformMatrix4fv(l, false, m);
  }

  /** Bind a texture to a unit and point the sampler uniform at it. */
  setTexture(name: string, texture: WebGLTexture, unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    this.setInt(name, unit);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
    this.uniforms.clear();
    this.cache.clear();
  }
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  stage: 'vertex' | 'fragment',
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new ShaderError('createShader returned null', stage, '', source);

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '(no log)';
    gl.deleteShader(shader);
    throw new ShaderError(
      `Failed to compile ${stage} shader:\n${log}\n${annotate(source, log)}`,
      stage,
      log,
      source,
    );
  }
  return shader;
}

/**
 * Pull the offending lines out of the source so the console shows the actual
 * code, not just "ERROR: 0:47". Debugging generated GLSL without this is
 * miserable.
 */
function annotate(source: string, log: string): string {
  const lines = source.split('\n');
  const matches = [...log.matchAll(/ERROR:\s*\d+:(\d+)/g)];
  if (matches.length === 0) return '';
  const out: string[] = [];
  for (const m of matches) {
    const lineNo = Number(m[1]);
    for (let i = Math.max(1, lineNo - 2); i <= Math.min(lines.length, lineNo + 2); i++) {
      const marker = i === lineNo ? '>>' : '  ';
      out.push(`${marker} ${String(i).padStart(4)} | ${lines[i - 1]}`);
    }
    out.push('');
  }
  return out.join('\n');
}
