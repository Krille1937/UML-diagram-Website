/**
 * @fileoverview Java UML Diagram Generator
 *
 * Parses uploaded .java source files and renders an interactive
 * UML class diagram in SVG. Supports classes, interfaces, enums,
 * and abstract classes, with inheritance and implementation arrows.
 *
 * @author  Kristoffer Oltegen Diehl
 * @version 0.1.8
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
 * @returns {ClassDescriptor|null} Parsed descriptor, or null if no declaration was found
 */
function parseJavaFile(src) {
    try {
        // Strip block comments, line comments, and string/char literals so that
        // braces and keywords inside them do not confuse the parser.
        src = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
        src = src.replace(/\/\/[^\n]*/g, '');
        src = src.replace(/"(?:[^"\\]|\\.)*"/g, '""');
        src = src.replace(/'(?:[^'\\]|\\.)*'/g, "''");

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
 * @param {string} className     - Enclosing class name (used to recognise constructors)
 * @returns {{ fields: FieldDescriptor[], methods: MethodDescriptor[] }}
 */
function extractMembers(body, className) {
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
                else                        parseFieldDecl(text, fields);
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
        } else if ((ch === ' ' || ch === '\t' || ch === '\n') && depth === 0) {
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
 *  - 'visibility'   UML symbol: '+' public, '-' private, '#' protected, '~' package-private
 *  - 'isStatic'    true if the 'static' keyword was present
 *  - 'isFinal'     true if the 'final' keyword was present
 *  - 'isAbstract'  true if the 'abstract' keyword was present
 *  - 'startIndex'  index of the first non-modifier token (the type or method name)
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
    text = text.replace(/@\w+(?:\([^)]*\))?\s*/g, '').trim();
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

/**
 * Format a {@link FieldDescriptor} as a UML attribute string.
 * 
 * Format: {@code <visibility>[/]<name> : <type>}
 * The '/' prefix marks a static (class-level) attribute per UML 2 conventions.
 * 
 * @example
 * Returns "+ /MAX_RETIRES : int"
 * fieldToString({ visibility: '+', isStatic: true, name: 'MAX_RETRIES', type: 'int' });
 * 
 * @param {FieldDescriptor} f - Field to format 
 * @returns {string} UML attribute string
 */
function fieldToString(f) {
    let s = f.visibility + ' ';
    if (f.isStatic) s += '/';
    s += f.name + ' : ' + f.type;
    return s;
}

/**
 * Format a {@link MethodDescriptor} as a UML operation string.
 * 
 * Format: {@code <visibility>[/][~]<name>(<paramTypes>) [: <returnType>]}
 * - '/' prefix marks a static operation.
 * - '~' prefix marks an abstract operation.
 * - Constructors omit the return type suffix.
 * 
 * @example
 * Returns "+ findAll(String) : List<User>"
 * methodToString({ visibiltiy: '+', isStatic: false, isAbstract: false,
 *                  name: 'findAll', params: [{ type: 'String' }],
 *                  returnType: 'List<User>', isConstructor: false });
 * 
 * @param {MethodDescriptor} m - Method to format
 * @returns {string} UML operation string
 */
function methodToString(m) {
    let s = m.visibility + ' ';
    if (m.isStatic) s += '/';
    if (m.isAbstract) s += '~';
    const params = m.params.map(p => p.type).join(', ');
    s += m.name + '(' + params + ')';
    if (m.returnType) s += ' : ' + m.returnType;
    return s;
}

/**
 * Escape a value for safe embedding in XML/SVG text content or attribute values.
 * 
 * Replace the five XML special characters: {@code & < > " '}
 * 
 * @param {*} s - Value to escape (coerced to string via String())
 * @returns {string} XML-safe string
 */
function escapeXml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}


// ════════════════════════════════════════════════════════════════
// BOX DIMENSIONS
// ════════════════════════════════════════════════════════════════

/**
 * Compute the pixel dimensions of the UML box for a given class descriptor.
 * 
 * Width is the maximum of the class-name width and the longest member-string
 * width, clamped to the range [{@link MIN_W}, {@link MAX_W}].
 * Height is the sum of the fixed header height, the field section height,
 * and the method section height, each with top/bottom padding. 
 * 
 * @param {ClassDescriptor} cls - Class whose box dimensions are needed
 * @returns {BoxDimensions} Computed { w, h, fh }
 */
function calcDimensions(cls) {
    const nameW = cls.name.length * 9.5 + H_PAD * 2;
    const allTexts = [
        ...cls.fields.map(fieldToString),
        ...cls.methods.map(methodToString)
    ];
    const contentW = allTexts.length
        ? Math.max(...allTexts.map(t => t.length * CHAR_W)) + H_PAD * 2
        : MIN_W;
    
    const w  = Math.min(MAX_W, Math.max(MIN_W, nameW, contentW));
    const fh = cls.fields.length  ? V_PAD + cls.fields.length  * LINE_H + V_PAD : SEC_MIN;
    const mh = cls.methods.length ? V_PAD + cls.methods.length * LINE_H + V_PAD : SEC_MIN;
    const h  = HEADER_H + 1 + fh + 1 + mh;

    return { w, h, fh };
}


// ════════════════════════════════════════════════════════════════
// AUTO-LAYOUT
// ════════════════════════════════════════════════════════════════

/**
 * Assign canvas positions to all loaded classes using a depth-based hierarchical layout.
 * 
 * Algorithm:
 * 1. Assign an inheritance depth to each class via cycle-safe DFS:
 *    classes with no known parent get depth 0 (top row).
 * 2. Group classes by depth into rows.
 * 3. Compute a Y origin for each row (parents above children).
 * 4. Center each row horizontally within an assumed canvas width.
 * 
 * Positions are only written for classes that do not already have a manually
 * assigned position (i.e. that the user has not dragged).
 * 
 * Side effects: populates {@link positions} and {@link dims} for all entries
 * in {@link classMap}.
 * 
 * @returns {void}
 */
function autoLayout() {
    const names = Object.keys(classMap);
    if (!names.length) return;

    // Step 1: depth assignment via cycle-safe DFS
    const levelMap = {};

    /**
     * Recursively determine the inheritance depth of a single class.
     * 
     * @param {string} name - Class name to resolve
     * @param {Set<string>} seen - Names on the current DFS stack (cycle guard)
     * @returns {number} Depth (0 = root / no known parent in classMap)
     */
    function getLevel(name, seen = new Set()) {
        if (seen.has(name)) return 0;
        if (levelMap[name] !== undefined) return levelMap[name];

        seen.add(name);
        const cls = classMap[name];
        let maxParent = -1;

        if (cls.extendsClass && classMap[cls.extendsClass]) {
            maxParent = Math.max(maxParent, getLevel(cls.extendsClass, seen));
        }
        cls.interfaces.forEach(ifc => {
            if (classMap[ifc]) maxParent = Math.max(maxParent, getLevel(ifc, seen));
        });

        return (levelMap[name] = maxParent + 1);
    }

    names.forEach(n => getLevel(n));

    // Step 2: group classes by depth level
    /** @type {Object.<number, string[]>} */
    const byLevel = {};
    names.forEach(n => {
        const lvl = levelMap[n] || 0;
        if (!byLevel[lvl]) byLevel[lvl] = [];
        byLevel[lvl].push(n);
    });

    const GAP_X = 40;       // horizontal gap between boxes in the same row
    const GAP_Y = 80;       // vertical gap between rows
    const CANVAS_W = 900;   // assumed canvas width used for centering

    // Step 3: compute Y origin for each row
    let cumulY = 20;
    /** @type {Object.<number, number>} Level index => Y coordinate. */
    const levelY = {};

    Object.entries(byLevel)
        .sort(([a], [b]) => +a - +b)
        .forEach(([lvl, classNames]) => {
            levelY[lvl] = cumulY;
            const maxH = Math.max(...classNames.map(n => calcDimensions(classMap[n]).h));
            cumulY += maxH + GAP_Y;
        });
    
    // Step 4: position boxes within each row, centered on CANVAS_W
    Object.entries(byLevel).forEach(([lvl, classNames]) => {
        const dList = classNames.map(n => calcDimensions(classMap[n]));
        const totalW = dList.reduce((sum, d) => sum + d.w, 0) + (classNames.length - 1) * GAP_X;
        let x = Math.max(20, (CANVAS_W - totalW) / 2);

        classNames.forEach((name, i) => {
            if (!positions[name]) positions[name] = { x, y: levelY[lvl] };
            dims[name] = dList[i];
            x += dList[i].w + GAP_X;
        });
    });

    // Ensure dims are cached even for boxes that alread had a manual position.
    names.forEach(n => { if (!dims[n]) dims[n] = calcDimensions(classMap[n]); });
}


// ════════════════════════════════════════════════════════════════
// RENDERING
// ════════════════════════════════════════════════════════════════

/**
 * Compute the start point, end point, and optional elbow mid-segment for a
 * relationship arrow connecting two UML boxes.
 * 
 * The algorithm selects the pair of box edges (top/bottom or left/right) that
 * produces the shortest arrow. Mostly-vertical arrows include a horizontal elbow
 * at the Y midpoint to avoid long diagonals.
 * 
 * @param {Position} fromPos - Top-left position of the source box
 * @param {BoxDimensions} fromDim - Dimensions of the source box
 * @param {Position} toPos - Top-left position of the target box
 * @param {BoxDimensions} toDim - Dimensions of the target box
 * @returns {ConnectionPoints} Computed arrow geometry
 */
function connectionPoints(fromPos, fromDim, toPos, toDim) {
    const fCX = fromPos.x + fromDim.w / 2;
    const fCY = fromPos.y + fromDim.h / 2;
    const tCX = toPos.x + toDim.w / 2;
    const tCY = toPos.y + toDim.h / 2;
    const dx = tCX - fCX;
    const dy = tCY - fCY;

    let sx, sy, ex, ey;

    if (Math.abs(dy) >= Math.abs(dx)) {
        // Mostly vertical - connect via top/bottom edges.
        if (dy < 0) {
            sx = fCX; sy = fromPos.y;           // source: top edge
            ex = tCX; ey = toPos.y + toDim.h;   // target: bottom edge
        } else {
            sx = fCX; sy = fromPos.y + fromDim.h;   // source: bottom edge
            ex = tCX; ey = toPos.y;                 // target: top edge
        }
    } else {
        // Mostly horizontal - connect via left/right edges.
        if (dx < 0) {
            sx = fromPos.x; sy = fCY;           // source: left edge
            ex = toPos.x + toDim.w; ey = tCY;   // target: right edge
        } else {
            sx = fromPos.x + fromDim.w; sy = fCY;   // source: right edge
            ex = toPos.x; ey = tCY;                 // target: left edge
        }
    }

    // Add a horizontal elbow for vertical arrows to prevent diagonal lines.
    const midY = (sy + ey) / 2;
    const elbowPath = Math.abs(dy) >= Math.abs(dx)
        ? `L${sx},${midY} L${ex},${midY}`
        : '';

    return { sx, sy, ex, ey, elbowPath };
}

/**
 * Build the SVG markup string for all inheritance and implementation arrows.
 * 
 * - Inheritance ({@code extends}): solid line with a hollow arrowhead ({@code #m-inh}).
 * - Implementation ({@code implements}): dashed line with a hollow arrowhead ({@code #m-impl}).
 * 
 * Arrows are only rendered when both endpoints have computed positions.
 * 
 * @returns {string} Concatenated SVG {@code <path>} elements as an HTML string fragment
 */
function renderArrows() {
    let svg = '';

    Object.keys(classMap).forEach(name => {
        const cls = classMap[name];
        const fromPos = positions[name];
        const fromDim = dims[name];
        if (!fromPos || !fromDim) return;

        // Inheritance arrow (solid line + hollow triangle)
        if (cls.extendsClass && classMap[cls.extendsClass]) {
            const toPos = positions[cls.extendsClass];
            const toDim = dims[cls.extendsClass];
            if (toPos && toDim) {
                const c = connectionPoints(fromPos, fromDim, toPos, toDim);
                svg +=  `<path d="M${c.sx},${c.sy} ${c.elbowPath} L${c.ex},${c.ey}"
                            fill="none"
                            stroke="var(--text-primary)"
                            stroke-opacity="0.35"
                            stroke-width="1.2"
                            marker-end="url(#m-inh)"/>`;
            }
        }

        // Implementation arrows (dashed line + hollow triangle)
        cls.interfaces.forEach(ifc => {
            if (!classMap[ifc]) return;
            const toPos = positions[ifc];
            const toDim = dims[ifc];
            if (toPos && toDim) {
                const c = connectionPoints(fromPos, fromDim, toPos, toDim);
                svg +=  `<path d="M${c.sx},${c.sy} ${c.elbowPath} L${c.ex},${c.ey}"
                            fill="none"
                            stroke="var(--text-primary)"
                            stroke-opacity="0.35"
                            stroke-width="1.2"
                            stroke-dasharray="6 3"
                            marker-end="url(#m-impl)"/>`;
            }
        });
    });

    return svg;
}

/**
 * Return the header fill color and text color CSS variable strings for a class.
 * 
 * Colors are defined as CSS custom properties in style.css and respond
 * automatically to light/dark mode without JavaScript intervention.
 * 
 * @param {ClassDescriptor} cls - Class whose header style is needed
 * @returns {HeaderColors} CSS value strings for fill and text
 */
function headerColors(cls) {
    if (cls.type === 'interface')   return { fill: 'var(--hdr-interface)',  text: 'var(--hdr-interface-text)' };
    if (cls.type === 'enum')        return { fill: 'var(--hdr-enum)',       text: 'var(--hdr-enum-text)' };
    if (cls.isAbstract)             return { fill: 'var(--hdr-abstract)',   text: 'var(--hdr-abstract-text)' };
    return                                 { fill: 'var(--hdr-class)',      text: 'var(--hdr-class-text)' };
}

/**
 * Build the SVG markup string for a single UML class box.
 * 
 * The box contains three horizontal sections separated by hairlines:
 * 1. **Header** - optional stereotype label and class name (italic for abstract).
 * 2. **Field section** - one row per {@link FieldDescriptor}.
 * 3. **Method section** - one row per {@link MethodDescriptor};
 *      constructors are rendered at reduced opacity.
 * 
 * The selected class receives a thicker, accent-colored border.
 * Text longer than 38 characters is truncated with an ellipsis.
 * 
 * @param {string} name - Key in {@link classMap} identifying the class to render
 * @returns {string} SVG {@code <g>} element as an HTML string, or '' if not yet positioned
 */
function renderBox(name) {
    const cls = classMap[name];
    const pos = positions[name];
    const dim = dims[name];
    if (!pos || !dim) return '';

    const { x, y } = pos;
    const { w, h, fh } = dim;
    const hc = headerColors(cls);
    const isSelected = (selectedClass === name);

    const strokeW = isSelected ? 2 : 0.5;
    const strokeC = isSelected ? 'var(--accent)' : 'var(--text-primary)';
    const strokeO = isSelected ? 0.9 : 0.25;

    let svg = `<g data-class="${escapeXml(name)}" style="cursor:move">`;

    // Outer box shell
    svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"
                style="fill:var(--bg-primary)"
                stroke="${strokeC}" stroke-width="${strokeW}" stroke-opacity="${strokeO}"/>`;

    
    // Header background (rounded top, flat bottom via an overlay strip)
    svg += `<rect x="${x}" y="${y}" width="${w}" height="${HEADER_H}" rx="3"
                style="fill:${hc.fill}" stroke="none"/>`;
    svg += `<rect x="${x}" y="${y + HEADER_H - 4}" width="${w}" height="4"
                style="fill:${hc.fill}" stroke="none"/>`;

    // Stereotype label and class name
    if (cls.type !== 'class') {
        // Non-class types show a «stereotype» label stacked above the name.
        const stereo = cls.type === 'interface' ? '«interface»'
                        : cls.type === 'enum'   ? '«enumeration»'
                        :                         `«${cls.type}»`;
        svg += `<text x="${x + w / 2}" y="${y + 13}"
                    text-anchor="middle"
                    font-family="monospace" font-size="10"
                    fill="${hc.text}" fill-opacity="0.65">${escapeXml(stereo)}</text>`;
        svg += `<text x="${x + w / 2}" y="${y + 30}"
                    text-anchor="middle"
                    font-family="sans-serif" font-size="13" font-weight="500"
                    fill="${hc.text}">${escapeXml(cls.name)}</text>`;
    } else {
        // Plain class, name centered in the header; italic for abstract classes.
        const fontStyle = cls.isAbstract ? 'italic' : 'normal';
        svg += `<text x="${x + w / 2}" y="${y + HEADER_H / 2 + 5}"
                    text-anchor="middle"
                    font-family="sans-serif" font-size="13" font-weight="500"
                    font-style="${fontStyle}"
                    fill="${hc.text}">${escapeXml(cls.name)}</text>`;
    }

    // Divider: header / fields
    svg += `<line x1="${x}" y1="${y + HEADER_H}"
                x2="${x + w}" y2="${y + HEADER_H}"
                stroke="var(--text-primary)" stroke-opacity="0.15" stroke-width="0.5"/>`;

    // Field rows
    const fieldBaseY = y + HEADER_H + V_PAD + LINE_H * 0.75;
    cls.fields.forEach((field, i) => {
        const text = fieldToString(field);
        const display = text.length > 38 ? text.substring(0, 36) + '…' : text;
        svg += `<text x="${x + H_PAD}" y="${fieldBaseY + i * LINE_H}"
                    font-family="monospace" font-size="11"
                    fill="var(--text-primary)" fill-opacity="0.8">${escapeXml(display)}</text>`;
    });

    // Divider: fields / methods
    const dividerY = y + HEADER_H + 1 + fh;
    svg += `<line x1="${x}" y1="${dividerY}"
                x2="${x + w}" y2="${dividerY}"
                stroke="var(--text-primary)" stroke-opacity="0.15" stroke-width="0.5"/>`;
    
    // Method rows (constructors at reduced opacity)
    const methodBaseY = dividerY + V_PAD + LINE_H * 0.75;
    cls.methods.forEach((method, i) =>{
        const text    = methodToString(method);
        const display = text.length > 38 ? text.substring(0, 36) + '…' : text;
        const opacity = method.isConstructor ? 0.55 : 0.8;
        svg += `<text x="${x + H_PAD}" y="${methodBaseY + i * LINE_H}"
                    font-family="monospace" font-size="11"
                    fill="var(--text-primary)" fill-opacity="${opacity}">${escapeXml(display)}</text>`;
    });

    svg += `</g>`;
    return svg;
}

/**
 * Re-render the complete diagram into the SVG world group.
 * 
 * Applies the current {@link viewTransform} to the world group, writes
 * all relationship arrows first (so they render behind class boxes),
 * then writes all class boxes.
 * 
 * Shows the empty-state placeholder when no classes are loaded.
 * 
 * @returns {void}
 */
function render() {
    const world = document.getElementById('world');
    const emptyState = document.getElementById('empty-state');
    const names = Object.keys(classMap);

    if (!names.length) {
        world.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    world.setAttribute(
        'transform',
        `translate(${viewTransform.tx},${viewTransform.ty}) scale(${viewTransform.sc})`
    );

    let svg = '';
    svg += renderArrows();
    names.forEach(n => { svg += renderBox(n); });
    world.innerHTML = svg;
}


// ════════════════════════════════════════════════════════════════
// FILE HANDLING
// ════════════════════════════════════════════════════════════════

/**
 * Read an array of {@link File} objects, parse any valid .java files,
 * register them in {@link classMap}, and refresh the diagram and sidebar.
 * 
 * Non .java files are silently skipped. Files that cannot be parsed log a
 * warning to the console and are otherwise ignored.
 * 
 * @param {File[]} files - Files from a file-input change or drag drop event
 * @returns {void}
 */
function handleFiles(files) {
    files.forEach(file => {
        if (!file.name.endsWith('.java')) return;

        const reader = new FileReader();
        reader.onload = e =>  {
            const cls = parseJavaFile(e.target.result);
            if (cls) {
                classMap[cls.name] = cls;
                autoLayout();
                render();
                updateFileList();
                updateBottomPanel();
            } else {
                console.warn('Could not parse:', file.name);
            }
        };
        reader.readAsText(file);
    });
}

/**
 * Rebuild the sidebar file list from the current contents of {@link classMap}.
 * 
 * Each entry renders as a clickable row (calls {@link selectClass}) with an
 * inline remove button (calls {@link removeClass}).
 * The currently selected class receives the CSS class 'selected'.
 * 
 * @returns {void}
 */
function updateFileList() {
    const list = document.getElementById('file-list');
    list.innerHTML = Object.values(classMap).map(cls => `
        <div class="file-item${selectedClass === cls.name ? ' selected' : ''}"
            onclick="selectClass('${escapeXml(cls.name)}')">
            <span class="file-name" title="${escapeXml(cls.name)}.java">${escapeXml(cls.name)}</span>
            <button class="remove-btn"
                onclick="event.stopPropagation(); removeClass('${escapeXml(cls.name)}')"
                title="Remove">x</button>
        </div>
    `).join('');
}

/**
 * Show or hide the legend and "Clear all" button based on whether any
 * classes are currently loaded.
 * 
 * @returns {void}
 */
function updateBottomPanel() {
    const hasClasses = Object.keys(classMap).length > 0;
    document.getElementById('bottom').style.display = hasClasses ? 'flex' : 'none';
}

/**
 * Toggle the selection state of a class box.
 * 
 * If {@code name} is already selected it becomes deselected (toggle off),
 * otherwise it becomes the new selection and any previous selection is cleared.
 * 
 * @param {string} name - Class name to select or deselect
 * @returns {void}
 */
function selectClass(name) {
    selectedClass = (selectedClass === name) ? null : name;
    render();
    updateFileList();
}

/**
 * Remove a class from the diagram completely.
 * 
 * Deletes entries for {@code name} from {@link classMap}, {@link positions},
 * and {@link dims}, clears the selection if the removed class was selected,
 * re-runs auto-layout, and refreshes the diagram and sidebar.
 * 
 * @param {string} name - Class name to remove
 * @returns {void}
 */
function removeClass(name) {
    delete classMap[name];
    delete positions[name];
    delete dims[name];
    if (selectedClass === name) selectedClass = null;
    autoLayout();
    render();
    updateFileList();
    updateBottomPanel();
}

/**
 * Remove all loaded classes and reset the viewport to its initial state.
 * 
 * Clears {@link classMap}, {@link positions}, {@link dims}, {@link selectedClass},
 * and {@link viewTransform}, then refreshes UI.
 * 
 * @returns {void}
 */
function clearAll() {
    classMap = {};
    positions = {};
    dims = {};
    selectedClass = null;
    viewTransform = { tx: 30, ty: 30, sc: 1 };
    render();
    updateFileList();
    updateBottomPanel();
}


// ════════════════════════════════════════════════════════════════
// INTERACTIONS
// ════════════════════════════════════════════════════════════════

/**
 * Convert a screen (client) coordinate to the SVG world coordinate space,
 * accounting for the current pan offset and zoom scale.
 * 
 * @param {number} clientX - X position in screen pixels (e.g. from a MouseEvent)
 * @param {number} clientY - Y position in screen pixels
 * @returns {Position} Equivalent position in world (SVG) coordinates
 */
function clientToWorld(clientX, clientY) {
    const rect = document.getElementById('diagram').getBoundingClientRect();
    return {
        x: (clientX - rect.left - viewTransform.tx) / viewTransform.sc,
        y: (clientY - rect.top - viewTransform.ty) / viewTransform.sc,
    };
}

// Mousedown

document.getElementById('diagram').addEventListener('mousedown', e => {
    const boxEl = e.target.closest('[data-class]');

    if (boxEl) {
        // Clicked on a class box - start a box drag.
        const name = boxEl.getAttribute('data-class');
        const wm = clientToWorld(e.clientX, e.clientY);
        const pos = positions[name];
        selectClass(name);
        dragState = {
            type: 'box',
            name,
            startMX: wm.x, startMY: wm.y,
            startBX: pos.x, startBY: pos.y
        };
    } else {
        // Clicked on empty canvas - deselect and start a pan.
        if (selectedClass) { selectedClass = null; render(); updateFileList(); }
        dragState = {
            type: 'pan',
            startMX: e.clientX, startMY: e.clientY,
            startTX: viewTransform.tx, startTY: viewTransform.ty
        };
    }

    e.preventDefault();
});


// Mousemove

window.addEventListener('mousemove', e => {
    if (!dragState) return;

    if (dragState.type === 'pan') {
        viewTransform.tx = dragState.startTX + (e.clientX - dragState.startMX);
        viewTransform.ty = dragState.startTY + (e.clientY - dragState.startMY);
    } else if (dragState.type === 'box') {
        const wm = clientToWorld(e.clientX, e.clientY);
        positions[dragState.name] = {
            x: dragState.startBX + (wm.x - dragState.startMX),
            y: dragState.startBY + (wm.y - dragState.startMY),
        };
    }

    render();
});

// Mouseup

window.addEventListener('mouseup', () => { dragState = null; });


// Scrollwheel

document.getElementById('diagram').addEventListener('wheel', e => {
    e.preventDefault();

    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = document.getElementById('diagram').getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const newScale = Math.max(0.15, Math.min(4, viewTransform.sc * factor));

    // Adjust translation so the point under the cursor stays fixed.
    viewTransform.tx = mx - (mx - viewTransform.tx) * (newScale / viewTransform.sc);
    viewTransform.ty = my - (my - viewTransform.ty) * (newScale / viewTransform.sc);
    viewTransform.sc = newScale;

    render();
}, { passive: false });


// ════════════════════════════════════════════════════════════════
// TOOLBAR ACTIONS
// ════════════════════════════════════════════════════════════════

/**
 * Zoom the diagram in or out, centered on the middle of the canvas.
 * 
 * The resulting scale is clamped to the range [0.15, 4.0].
 * 
 * @param {number} factor - Multiplier applied to the current scale
 *                          (e.g. 1.2 zooms in, 0.83 zooms out)
 * @returns {void}
 */
function zoom(factor) {
    const rect = document.getElementById('diagram').getBoundingClientRect();
    const mx = rect.width / 2;
    const my = rect.height / 2;
    const ns = Math.max(0.15, Math.min(4, viewTransform.sc * factor));

    viewTransform.tx = mx - (mx - viewTransform.tx) * (ns / viewTransform.sc);
    viewTransform.ty = my - (my - viewTransform.ty) * (ns / viewTransform.sc);
    viewTransform.sc = ns;
    render();
}

/**
 * Scale and translate the view so that all loaded class boxes fit within
 * the visible canvas area with a 30 px margin on each side.
 * 
 * The scale is capped at 1.5 to prevent over-enlargement when only a few
 * small boxes are loaded. Has no effect when no classes are loaded.
 * 
 * @returns {void}
 */
function fitView() {
    const names = Object.keys(classMap);
    if (!names.length) return;

    // Compute the bounding box of all class boxes.
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    names.forEach(n => {
        const p = positions[n];
        const d = dims[n];
        if (!p || !d) return;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + d.w);
        maxY = Math.max(maxY, p.y + d.h);
    });

    const rect = document.getElementById('diagram').getBoundingClientRect();
    const W = rect.width - 60;
    const H = rect.height - 60;
    const bw = maxX - minX;
    const bh = maxY - minY;
    const ns = Math.min(W / bw, H / bh, 1.5);

    viewTransform.sc = ns;
    viewTransform.tx = 30 - minX * ns;
    viewTransform.ty = 30 - minY * ns;
    render();
}


// ════════════════════════════════════════════════════════════════
// DRAG DROP & FILE INPUT
// ════════════════════════════════════════════════════════════════

const dropZone = document.getElementById('drop-zone');
 
dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

/**
 * Handle files dropped onto the sidebar drop zone.
 * Non .java files in the drop payload are silently ignored by {@link handleFiles}.
 * 
 * @listens drop
 */
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    handleFiles(Array.from(e.dataTransfer.files));
});

/**
 * Handle files selected via the hidden {@code <input type="file">} element.
 * 
 * The input value is reset after reading so the same file can be re-uploaded
 * after being removed from the diagram.
 * 
 * @listens change
 */
document.getElementById('file-input').addEventListener('change', function (e) {
    handleFiles(Array.from(e.target.files));
    this.value = '';
});


// ════════════════════════════════════════════════════════════════
// INIT RENDER
// ════════════════════════════════════════════════════════════════

render();
