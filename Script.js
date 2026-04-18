/**
 * @fileoverview Java UML Diagram Generator
 *
 * Parses uploaded .java source files and renders an interactive
 * UML class diagram in SVG. Supports classes, interfaces, enums,
 * and abstract classes, with inheritance and implementation arrows.
 *
 * @author  Kristoffer Oltegen Diehl
 * @version 0.1.7
 */


// ════════════════════════════════════════════════════════════════
//  TYPE DEFINITIONS
// ════════════════════════════════════════════════════════════════

/**
 * A parsed Java field descriptor.
 *
 * @typedef  {Object} FieldDescriptor
 * @property {string}  visibility - UML visibility symbol: '+' | '-' | '#' | '~'
 * @property {boolean} isStatic   - Whether the field is declared static
 * @property {boolean} isFinal    - Whether the field is declared final
 * @property {string}  type       - Declared Java type (may include generics, e.g. "List<String>")
 * @property {string}  name       - Field identifier
 */

/**
 * A single parameter in a method signature.
 *
 * @typedef  {Object} ParamDescriptor
 * @property {string} type - Parameter type (may include generics)
 * @property {string} name - Parameter identifier, or '' if unparseable
 */

/**
 * A parsed Java method or constructor descriptor.
 *
 * @typedef  {Object} MethodDescriptor
 * @property {string}            visibility    - UML visibility symbol: '+' | '-' | '#' | '~'
 * @property {boolean}           isStatic      - Whether the method is declared static
 * @property {boolean}           isAbstract    - Whether the method is declared abstract
 * @property {string}            name          - Method identifier
 * @property {string}            returnType    - Return type string, or '' for constructors
 * @property {ParamDescriptor[]} params        - Ordered list of parameters
 * @property {boolean}           isConstructor - True when the method name matches the class name
 */

/**
 * A fully parsed Java type (class, interface, enum, or annotation type).
 *
 * @typedef  {Object} ClassDescriptor
 * @property {string}             name          - Simple class name
 * @property {string}             type          - Declaration keyword: 'class' | 'interface' | 'enum' | '@interface'
 * @property {boolean}            isAbstract    - True for abstract classes and all interfaces
 * @property {string|null}        extendsClass  - Simple name of the superclass, or null
 * @property {string[]}           interfaces    - Simple names of implemented interfaces
 * @property {FieldDescriptor[]}  fields        - Declared fields at body depth 0
 * @property {MethodDescriptor[]} methods       - Declared methods and constructors at body depth 0
 */

/**
 * A 2-D position on the SVG canvas (world coordinates).
 *
 * @typedef  {Object} Position
 * @property {number} x - Horizontal offset in pixels
 * @property {number} y - Vertical offset in pixels
 */

/**
 * Pre-computed layout dimensions for a UML box.
 *
 * @typedef  {Object} BoxDimensions
 * @property {number} w  - Box width in pixels
 * @property {number} h  - Total box height (header + field section + method section)
 * @property {number} fh - Height of the field section only
 */

/**
 * The current pan/zoom state of the SVG viewport.
 *
 * @typedef  {Object} ViewTransform
 * @property {number} tx - Horizontal translation in screen pixels
 * @property {number} ty - Vertical translation in screen pixels
 * @property {number} sc - Uniform scale factor (1.0 = 100%)
 */

/**
 * An active drag operation — either panning the canvas or moving a class box.
 *
 * @typedef  {Object} DragState
 * @property {'pan'|'box'}  type    - Whether the user is panning or moving a box
 * @property {string}       [name]  - Class name being dragged (box drags only)
 * @property {number}       startMX - World / screen X at drag start
 * @property {number}       startMY - World / screen Y at drag start
 * @property {number}       [startBX] - Box X at drag start (box drags only)
 * @property {number}       [startBY] - Box Y at drag start (box drags only)
 * @property {number}       [startTX] - viewTransform.tx at drag start (pan drags only)
 * @property {number}       [startTY] - viewTransform.ty at drag start (pan drags only)
 */

/**
 * Geometry for a relationship arrow between two UML boxes.
 *
 * @typedef  {Object} ConnectionPoints
 * @property {number} sx         - Arrow start X (on the source box edge)
 * @property {number} sy         - Arrow start Y (on the source box edge)
 * @property {number} ex         - Arrow end X (on the target box edge)
 * @property {number} ey         - Arrow end Y (on the target box edge)
 * @property {string} elbowPath  - SVG path data for an elbow joint, or '' for straight lines
 */

/**
 * CSS value strings for the header background and text of a UML box.
 *
 * @typedef  {Object} HeaderColors
 * @property {string} fill - CSS value for the header rectangle fill
 * @property {string} text - CSS value for the header text color
 */


// ════════════════════════════════════════════════════════════════
// APPLICATION STATE
// ════════════════════════════════════════════════════════════════


let classMap = {};  // className -> parsed class object
let positions = {}; // className -> { x, y }
let dims = {};      // className -> { w, h, fh }
let viewTransform = { tx: 30, ty: 30, sc: 1 };
let dragState = null;
let selectedClass = null;

// CONSTANTS
const CHAR_W    = 7;
const LINE_H    = 18;
const H_PAD     = 10;
const V_PAD     = 6;
const HEADER_H  = 44;
const SEC_MIN   = 8;
const MIN_W     = 160;
const MAX_W     = 290;

/**
 * All Java modifier keywords that may appear before a type, field, or method declaration.
 * Used by {@link extractModifiers} to consume leading tokens.
 *
 * @const {Set<string>}
 */
const MODIFIERS = new Set([
    'public','private','protected','static','final',
    'transient','volatile','abstract','synchronized',
    'native','default','strictfp'
]);


// ════════════════════════════════════════════════════════════════
// JAVA PARSER
// ════════════════════════════════════════════════════════════════

/**
 * Parse a single Java source file and return a {@link ClassDescriptor}.
 * 
 * The parser:
 * 1. Strips block comments, line comments, and string/char literals.
 * 2. Locates the outermost type declaration with a regular expression.
 * 3. Extracts the class body using brace-balancing.
 * 4. Delegates member extraction to {@link extractMembers}.
 * 
 * @param {string} src - Raw text content of a .java file
 * @returns {ClassDescriptot|null} Parsed descriptor, or null if no declaration was found
 */
function parseJavaFile(src) {
    try {
        // Strip block comments, line comments, and string/char literals so that
        // braces and keywords inside them do not confuse the parser.
        src = src.replace(/\/\*[\s\S]*?\//g, ' ');
        src = src.replace(/\/\/[^\n]*/g, '');
        src = src.replace(/"(?:[^"\\]|\\.)*"/g, '""');
        src = src.replace(/'(?:[^"\\]|\\.)*'/g, "''");

        // Capture groups: (1) keyword, (2) name, (3) superclass, (4) interface list
        const CLASS_RE = /(?:(?:public|private|protected|abstract|final|strictfp)\s+)*(?:(class|interface|enum|@interface)\s+(\w+))(?:\s*<[^{]*>)?(?:\s+extends\s+([\w.<>[\]?,\s]+?))?(?:\s+implements\s+([\w.<>[\]?,\s]+?))?\s*\{/;
        const match = CLASS_RE.exec(src);
        if (!match) return null;

        const type          = match[1];
        const name          = match[2];
        const extendsClass  = match[3] ? match[3].trim().split(/[<\s]/)[0] : null;
        const interfaces    = match[4]
            ? match[4].split(',').map(s => s.trim().split(/[<\s]/)[0]).filter(Boolean)
            : [];

        // Balance braces to extract the class body.
        const bodyStart = src.indexOf('{', match.index + match[0].length - 1);
        let depth = 1;
        let i = bodyStart + 1;
        while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
        }
        const body = src.substring(bodyStart + 1, i - 1);

        const { fields, methods } = extractMembers(body, name);

        // Detect the 'abstract' modifier on the class declaration itself.
        const preDecl       = src.substring(0, match.index + match[0].indexOf(match[1]));
        const isAbstract    = /\babstract\b/.test(preDecl.split('\n').slice(-3).join(' '))
                                || type === 'interface';
        
        return { name, type, isAbstract, extendsClass, interfaces, fields, methods };
    } catch (err) {
        console.warn('Parse error', err);
        return null;
    }
}

/**
 * Walk a class body at brace-depth 0 and collect all field and method declarations.
 * 
 * Two signals identify declaration boundaries at depth 0:
 * - A semicolon ends a field declaration (or an abstract / interface method).
 * - An opening brace ends a method header; the body is skipped by depth tracking.
 * 
 * @param {string} body     - Raw class body text (between the outermost braces)
 * @param {*} className     - Enclosing class name (used to recognise constructs)
 * @returns {{ fields: FieldDescriptor[], methods: MethodDescriptor[] }}
 */
function exctractMembers(body, className) {
    const fields    = [];
    const methods   = [];
    let depth       = 0;
    let current     = '';

    for (let i = 0; i < body.length; i++) {
        const ch = body[i];

        if (ch === '{') {
            if (depth === 0 && current.trim()) {
                // A '(' in the accumulated text indicates a method/constructor header.
                if (/\w\s*\(/.test(current)) {
                    parseMethodDecl(current.trim(), methods, className);
                }
                current = '';
            }
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) current = '';
        } else if (ch === ';' && depth === 0) {
            const text = current.trim();
            if (text) {
                if (/\w\s*\(/.test(text)) parseMethodDecl(text, methods, className);
                else                        parseMethodDecl(text, fields);
            }
            current = '';
        } else if (depth === 0) {
            current += ch;
        }
    }

    return { fields, methods };
}

/**
 * Tokenize a Java declaration fragment into whitespace-separated tokens,
 * treating generic type parameters as a single token so that types such as
 * {@code Map<String, List<Integer>>} are never split.
 * 
 * @param {string} text - Declaration fragment to tokenize 
 * @returns {string[]}  Array of tokens in source order
 */
function tokenizeSmart(text) {
    const tokens = [];
    let current = '';
    let depth   = 0;

    for (const ch of text) {
        if(ch === '<') {
            depth++;
            current += ch;
        } else if (ch === '>') {
            depth--;
            current += ch;
        } else if ((ch === '' || ch === '\t' || ch === '\n') && depth === 0) {
            if (current) { tokens.push(current); current = ''; }
        } else {
            current += ch;
        }
    }

    if (current) tokens.push(current);
    return tokens;
}

/**
 * Consume leading Java modifier keywords from a token list and return their meaning.
 * 
 * Scans token in order, stopping at the first non-modifier token.
 * Multiple access modifiers in the same declaration are tolerated;
 * the last one encountered determines the visibility symbol.
 * 
 * @param {string[]} tokens - Token array from {@link tokenizeSmart}
 * @returns {{ visibility: string, isStatic: boolean, isFinal: boolean, isAbstract: boolean, startIndex: number }}
 *  - 'visibilty'   UML symbol: '+' public, '-' private, '#' protected, '~' package-private
 *  - 'isStatic'    true if the 'static' keyword was present
 *  - 'isFinal'     true if the 'final' keyword was present
 *  - 'isAbstract'  true if the 'abstract' keyword was present
 *  - 'startIndex'  index of the first non-modifier toekn (the type or method name)
 */
function extractModifiers(tokens) {
    let visibility  = '~'    // package-private by default
    let isStatic    = false;
    let isFinal     = false;
    let isAbstract  = false;
    let i = 0;

    while (i < tokens.length && MODIFIERS.has(tokens[i])) {
        switch (tokens[i]) {
            case 'public':      visibility = '+'; break;
            case 'private':     visibility = '-'; break;
            case 'protected':   visibility = '#'; break;
            case 'static':      isStatic   = true; break;
            case 'final':       isFinal    = true; break;
            case 'abstract':    isAbstract = true; break;
        }
        i++;
    }

    return { visibility, isStatic, isFinal, isAbstract, startIndex: i };
}

/**
 * Parse a single field declaration and push a {@link FieldDescriptor} onto {@code fields}.
 * 
 * Handles annotations, initializers (everything after '=' is discarded),
 * and generic types. Declarations that cannot be resolved to a valid
 * type + identifier pair are silently skipped.
 * 
 * @param {string} text                 - Raw field declaration text (no trailing semicolon)
 * @param {FieldDescriptor[]} fields    - Accumulator array; result is pushed here
 * @returns {void} 
 */
function parseFieldDecl(text, fields) {
    // Strip annotations such as @Override or @SuppressWarnings("unused").
    text = text.replace(/@\w+(?:\/[^)]*\))?\s*/g, '').trim();
    if (!text) return;

    // Discard the initializer - only the type and name are relevant for UML.
    const eqIdx = text.indexOf('=');
    if (eqIdx > -1) text = text.substring(0, eqIdx).trim();

    const tokens = tokenizeSmart(text);
    if (tokens.length < 2) return;

    const { visibility, isStatic, isFinal, startIndex } = extractModifiers(tokens);
    if (startIndex > tokens.length - 2) return;

    const name = tokens[tokens.length - 1];
    const type = tokens.slice(startIndex, tokens.length - 1).join('');

    if (!name || !type || !/^\w/.test(name)) return;

    fields.push({ visibility, isStatic, isFinal, type, name });
}

/**
 * Parse a single method or constructor declaration and push a {@link MethodDescriptor}
 * onto {@code methods}.
 *
 * Strips annotations and the {@code throws} clause before parsing.
 * Balances parentheses to find the parameter list even when parameter types
 * contain generic arguments (e.g. {@code Comparator<Map.Entry<K,V>>}).
 *
 * @param  {string} text                - Raw method header (no opening brace or semicolon)
 * @param  {MethodDescriptor[]} methods - Accumulator array; result is pushed here
 * @param  {string} className           - Enclosing class name, used to identify constructors
 * @returns {void}
 */
function parseMethodDecl(text, methods, className) {
    text = text.replace(/@\w+(?:\([^)]*\))?\s*/g, '').trim();
    if (!text) return;
 
    // Remove the 'throws' clause - it is not shown in UML signatures.
    text = text.replace(/\s+throws\s+[\w,\s.<>[\]]+$/, '').trim();
 
    // Find the outermost opening parenthesis.
    const parenOpen = text.indexOf('(');
    if (parenOpen < 0) return;
 
    // Balance parentheses to find the closing paren of the parameter list.
    let depth      = 0;
    let parenClose = -1;
    for (let i = parenOpen; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') {
            depth--;
            if (depth === 0) { parenClose = i; break; }
        }
    }
    if (parenClose < 0) return;
 
    const paramsStr   = text.substring(parenOpen + 1, parenClose);
    const beforeParen = text.substring(0, parenOpen).trim();
    const tokens      = tokenizeSmart(beforeParen);
 
    const { visibility, isStatic, isAbstract, startIndex } = extractModifiers(tokens);
    if (startIndex >= tokens.length) return;
 
    const name = tokens[tokens.length - 1];
    if (!name || !/^\w/.test(name)) return;
 
    const isConstructor = (name === className);
    const returnType    = isConstructor
        ? ''
        : (tokens.slice(startIndex, tokens.length - 1).join('') || 'void');
 
    const params = paramsStr.trim() ? parseParams(paramsStr) : [];
    methods.push({ visibility, isStatic, isAbstract, name, returnType, params, isConstructor });
}

/**
 * Parse a comma-separated method parameter list into an ordered array of
 * {@link ParamDescriptor} objects.
 *
 * Commas inside generic angle-brackets or nested parentheses are NOT treated
 * as parameter separators, so types such as {@code Map<K, V>} or
 * {@code Callable<List<T>>} are parsed correctly as single tokens.
 * Annotations and vararg ellipses ({@code ...}) are stripped from each parameter.
 *
 * @param  {string} str - Parameter list text (without the surrounding parentheses)
 * @returns {ParamDescriptor[]} Ordered array of parsed parameter descriptors
 */
function parseParams(str) {
    // Split on top-level, commas, respecting angle brackets and parentheses.
    const parts = [];
    let depth   = 0;
    let current = '';

    for (const ch of str) {
        if (ch === '<' || ch === '(') { depth++; current += ch; }
        else if (ch === '>' || ch === ')') { depth--; current += ch; }
        else if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; }
        else current += ch;
    }
    if (current.trim()) parts.push(current.trim());

    return parts
        .map(p => {
            p = p.replace(/@\w+(?:\([^)]*\))?\s*/g, '').replace(/\.\.\./g, '').trim();
            const toks = tokenizeSmart(p);
            if (toks.length >= 2) {
                return {
                    type: toks.slice(0, toks.length - 1).join(''),
                    name: toks[toks.length - 1]
                };
            }
            // Single token - treat it as the type with no parseable name.
            return { type: p, name: '' };
        })
        .filter(p => p.type);  // discard empty descriptors
}


// ════════════════════════════════════════════════════════════════
// DISPLAY STRING HELPERS
// ════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════
// DIMENSIONS
// ════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════
// AUTO-LAYOUT
// ════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════
// RENDERING
// ════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════
// FILE HANDLING
// ════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════
// INTERACTIONS
// ════════════════════════════════════════════════════════════════


// ═══ Toolbar buttons ════════════════════════════════════════════

// ═══ Drag-&-drop on the drop zone ═══════════════════════════════

// ═══ Initial render ═════════════════════════════════════════════
render();
