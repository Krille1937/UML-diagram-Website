/**
 * @fileoverview Java UML Diagram Generator
 *
 * Parses uploaded .java source files and renders an interactive
 * UML class diagram in SVG. Supports classes, interfaces, enums,
 * and abstract classes with six relationship arrow types:
 * inheritance, implementation, composition, aggregation,
 * dependency «use», and dependency «creates».
 *
 * @author  Kristoffer Oltegen Diehl
 * @version 1.0.0
 */


// ════════════════════════════════════════════════════════════════
//  TYPE DEFINITIONS
// ════════════════════════════════════════════════════════════════

/**
 * A parsed Java field descriptor.
 *
 * @typedef  {Object}  FieldDescriptor
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
 * @typedef  {Object}            MethodDescriptor
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
 * @typedef  {Object}             ClassDescriptor
 * @property {string}             name          - Simple class name
 * @property {string}             type          - Declaration keyword: 'class' | 'interface' | 'enum' | '@interface'
 * @property {boolean}            isAbstract    - True for abstract classes and all interfaces
 * @property {string|null}        extendsClass  - Simple name of the superclass, or null
 * @property {string[]}           interfaces    - Simple names of implemented interfaces
 * @property {FieldDescriptor[]}  fields        - Declared fields at body depth 0
 * @property {MethodDescriptor[]} methods       - Declared methods and constructors at body depth 0
 * @property {string[]}           instantiations - Types instantiated with {@code new} anywhere in the class body
 * @property {string[]}           bodyUses       - Other types referenced in the body (casts, instanceof, static calls, etc.)
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
 * @typedef  {Object}       DragState
 * @property {'pan'|'box'}  type      - Whether the user is panning or moving a box
 * @property {string}       [name]    - Class name being dragged (box drags only)
 * @property {number}       startMX   - World / screen X at drag start
 * @property {number}       startMY   - World / screen Y at drag start
 * @property {number}       [startBX] - Box X at drag start (box drags only)
 * @property {number}       [startBY] - Box Y at drag start (box drags only)
 * @property {number}       [startTX] - viewTransform.tx at drag start (pan drags only)
 * @property {number}       [startTY] - viewTransform.ty at drag start (pan drags only)
 */

/**
 * Geometry for a relationship arrow between two UML boxes.
 *
 * @typedef  {Object} ConnectionPoints
 * @property {number} sx        - Arrow start X (on the source box edge)
 * @property {number} sy        - Arrow start Y (on the source box edge)
 * @property {number} ex        - Arrow end X (on the target box edge)
 * @property {number} ey        - Arrow end Y (on the target box edge)
 * @property {string} elbowPath - SVG path data for an elbow joint, or '' for straight lines
 */

/**
 * CSS value strings for the header background and text of a UML box.
 *
 * @typedef  {Object} HeaderColors
 * @property {string} fill - CSS value for the header rectangle fill
 * @property {string} text - CSS value for the header text color
 */

/**
 * A detected UML relationship from one class to another.
 *
 * @typedef  {Object} Relationship
 * @property {string} type   - 'composition' | 'aggregation' | 'depUse' | 'depCreates'
 * @property {string} target - Simple name of the target class
 */


// ════════════════════════════════════════════════════════════════
//  APPLICATION STATE
// ════════════════════════════════════════════════════════════════

/** @type {Object.<string, ClassDescriptor>} Map from class name to its parsed descriptor. */
let classMap = {};

/** @type {Object.<string, Position>} Map from class name to its canvas position. */
let positions = {};

/** @type {Object.<string, BoxDimensions>} Map from class name to its cached box dimensions. */
let dims = {};

/** @type {ViewTransform} Current pan and zoom state of the SVG world group. */
let viewTransform = { tx: 30, ty: 30, sc: 1 };

/** @type {DragState|null} The active drag operation, or null when idle. */
let dragState = null;

/** @type {string|null} The class name currently selected (highlighted), or null. */
let selectedClass = null;

/** @type {string} The overarching diagram title shown in the bracket overlay. */
let diagramTitle = '';

/** @type {string} The active color theme identifier. */
let currentTheme = 'default';

/**
 * Visibility flags for each detected relationship arrow type.
 * Setting a flag to false hides all arrows of that type.
 *
 * @type {{ composition: boolean, aggregation: boolean, depUse: boolean, depCreates: boolean }}
 */
let visRelationships = {
    composition: true,
    aggregation: true,
    depUse:      true,
    depCreates:  true,
};

/**
 * Visibility flags for each member category shown inside class boxes.
 * Setting a flag to false hides those rows and shrinks the box height accordingly.
 *
 * @type {{ fields: boolean, methods: boolean, constructors: boolean }}
 */
let visMembers = {
    fields:       true,
    methods:      true,
    constructors: true,
};

/**
 * World-coordinate position of the draggable legend box.
 *
 * Null until the first render with at least one relationship present,
 * at which point it is auto-placed to the right of the class bounding box.
 * Reset to null by {@link clearAll}.
 *
 * @type {{ x: number, y: number }|null}
 */
let legendPos = null;

/**
 * User-defined elbow offsets for individual arrows.
 *
 * Key format: `"fromName::toName::relType"`.
 * Value: a number representing the pixel delta the user has dragged the bend
 * handle away from the natural midpoint. Positive = right/down, negative = left/up.
 *
 * @type {Object.<string, number>}
 */
const bendOffsets = {};

/**
 * Cache of the last-rendered edge axis ('vertical' | 'horizontal') for each
 * arrow, keyed the same way as {@link bendOffsets}.
 *
 * Used to detect when a box drag causes an arrow's routing axis to flip, at
 * which point the stored bend offset is no longer meaningful and is discarded.
 *
 * @type {Object.<string, string>}
 */
const bendEdgeCache = {};

/**
 * All named canvas sections, ordered by creation time.
 *
 * @type {Array<{id: string, name: string, color: string}>}
 */
let sections = [];

/**
 * Maps each class name to the id of the section it belongs to, or null.
 *
 * @type {Object.<string, string|null>}
 */
let sectionAssignments = {};

/**
 * Cycling palette of muted tint colors for section backgrounds.
 * Each value is used as a semi-transparent fill on the canvas.
 *
 * @const {string[]}
 */
const SECTION_PALETTE = [
    'rgba(99,149,221,0.10)',   // blue
    'rgba(99,180,120,0.10)',   // green
    'rgba(221,149,99,0.10)',   // orange
    'rgba(180,99,180,0.10)',   // purple
    'rgba(180,160,60,0.10)',   // gold
    'rgba(99,180,180,0.10)',   // teal
];

/**
 * Solid border colors matching each SECTION_PALETTE entry, used for the
 * section outline and the swatch in the sidebar.
 *
 * @const {string[]}
 */
const SECTION_BORDER = [
    'rgba(99,149,221,0.45)',
    'rgba(99,180,120,0.45)',
    'rgba(221,149,99,0.45)',
    'rgba(180,99,180,0.45)',
    'rgba(180,160,60,0.45)',
    'rgba(99,180,180,0.45)',
];


// ════════════════════════════════════════════════════════════════
//  LAYOUT CONSTANTS
// ════════════════════════════════════════════════════════════════

/** @const {number} Approximate pixel width of one monospace character at 11 px. */
const CHAR_W   = 7;

/** @const {number} Pixel height of one text row inside the field or method section. */
const LINE_H   = 18;

/** @const {number} Horizontal padding (left and right) inside a UML box. */
const H_PAD    = 10;

/** @const {number} Vertical padding above and below text rows within a section. */
const V_PAD    = 6;

/** @const {number} Fixed pixel height of the class-name header section. */
const HEADER_H = 44;

/** @const {number} Minimum pixel height for a section that contains no rows. */
const SEC_MIN  = 8;

/** @const {number} Minimum pixel width for any UML box. */
const MIN_W    = 160;

/** @const {number} Maximum pixel width for any UML box (longer labels are truncated). */
const MAX_W    = 290;

/**
 * All Java modifier keywords that may appear before a type, field, or method declaration.
 * Used by {@link extractModifiers} to consume leading tokens.
 *
 * @const {Set<string>}
 */
const MODIFIERS = new Set([
    'public', 'private', 'protected', 'static', 'final',
    'transient', 'volatile', 'abstract', 'synchronized',
    'native', 'default', 'strictfp'
]);

/**
 * Java standard-library collection and map type names used to distinguish
 * aggregation (a class owns a collection of another class) from composition
 * (a class directly holds a single instance of another class).
 *
 * @const {Set<string>}
 */
const COLLECTION_TYPES = new Set([
    'List', 'ArrayList', 'LinkedList', 'Vector', 'Stack',
    'Set', 'HashSet', 'LinkedHashSet', 'TreeSet',
    'Queue', 'Deque', 'ArrayDeque', 'PriorityQueue',
    'Collection', 'Iterable',
    'Map', 'HashMap', 'LinkedHashMap', 'TreeMap',
    'Hashtable', 'ConcurrentHashMap', 'EnumSet', 'EnumMap',
]);


// ════════════════════════════════════════════════════════════════
//  JAVA PARSER
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
 * @param  {string}               src - Raw text content of a .java file
 * @returns {ClassDescriptor|null}     Parsed descriptor, or null if no declaration was found
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

        const type         = match[1];
        const name         = match[2];
        const extendsClass = match[3] ? match[3].trim().split(/[<\s]/)[0] : null;
        const interfaces   = match[4]
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

        // Scan the full class body for types that are instantiated, in two forms:
        //   1. `new ClassName(...)` — standard constructor call
        //   2. `ClassName::new`     — constructor method reference (e.g. BankGUI::new)
        // Comments and string literals have already been stripped, so false
        // positives from quoted or commented code are not a concern.
        const NEW_CALL_RE = /\bnew\s+(\w+)\s*[(<]/g;
        const NEW_REF_RE  = /\b(\w+)::new\b/g;
        const instantiations = [];
        const instSeen       = new Set();
        let nm;

        while ((nm = NEW_CALL_RE.exec(body)) !== null) {
            if (!instSeen.has(nm[1])) { instantiations.push(nm[1]); instSeen.add(nm[1]); }
        }
        while ((nm = NEW_REF_RE.exec(body)) !== null) {
            if (!instSeen.has(nm[1])) { instantiations.push(nm[1]); instSeen.add(nm[1]); }
        }

        // Scan for additional body-level uses that create a depUse dependency.
        // Each pattern targets a recognised Java construct that implies the class
        // knows about another type, without necessarily creating an instance of it:
        //
        //   Pattern                        Example Java
        //   ──────────────────────────────────────────────────────
        //   ClassName.member(              BankService.getInstance(   (static call)
        //   (ClassName)                    (BankAccount) obj          (type cast)
        //   instanceof ClassName           obj instanceof BankAccount (type check)
        //   ClassName::methodName          Arrays::sort               (method ref)
        //   catch (ClassName               catch (IOException e)      (exception)
        //   [A-Z]\w+ varName =|;           BankAccount acc = ...      (local var)
        //
        // Only identifiers starting with an uppercase letter are collected — Java
        // convention for class names — which filters out most false positives from
        // method names, local variables, and field access chains.

        const bodyUses  = [];
        const usesSeen  = new Set(instSeen);   // start from already-seen set to dedup

        /**
         * Attempt to add a type name to bodyUses, deduplicating against both
         * instantiations and previously seen body uses.
         *
         * @param {string} t - Candidate type name
         */
        function tryAddUse(t) {
            if (t && /^[A-Z]/.test(t) && !usesSeen.has(t)) {
                bodyUses.push(t);
                usesSeen.add(t);
            }
        }

        // Static member access:  ClassName.something(
        const STATIC_RE  = /\b([A-Z]\w+)\s*\.\s*\w+\s*\(/g;
        while ((nm = STATIC_RE.exec(body))  !== null) tryAddUse(nm[1]);

        // Type cast:  (ClassName)
        const CAST_RE    = /\(\s*([A-Z]\w+)\s*\)/g;
        while ((nm = CAST_RE.exec(body))    !== null) tryAddUse(nm[1]);

        // instanceof check:  instanceof ClassName
        const INST_OF_RE = /\binstanceof\s+([A-Z]\w+)/g;
        while ((nm = INST_OF_RE.exec(body)) !== null) tryAddUse(nm[1]);

        // Non-constructor method reference:  ClassName::methodName  (but not ::new)
        const MREF_RE    = /\b([A-Z]\w+)::(?!new\b)(\w+)/g;
        while ((nm = MREF_RE.exec(body))    !== null) tryAddUse(nm[1]);

        // catch clause type:  catch (ExceptionType
        const CATCH_RE   = /\bcatch\s*\(\s*([A-Z]\w+)/g;
        while ((nm = CATCH_RE.exec(body))   !== null) tryAddUse(nm[1]);

        // Local variable declaration:  ClassName varName [=|;|,]
        // Uses a simple heuristic: two consecutive capitalised identifiers at word
        // boundaries where the second looks like a variable name (lowercase start).
        const LOCAL_RE   = /\b([A-Z]\w+)\s+([a-z_]\w*)\s*[=;,)]/g;
        while ((nm = LOCAL_RE.exec(body))   !== null) tryAddUse(nm[1]);

        // Detect the 'abstract' modifier on the class declaration itself.
        const preDecl    = src.substring(0, match.index + match[0].indexOf(match[1]));
        const isAbstract = /\babstract\b/.test(preDecl.split('\n').slice(-3).join(' '))
                        || type === 'interface';

        return { name, type, isAbstract, extendsClass, interfaces, fields, methods, instantiations, bodyUses };
    } catch (err) {
        console.warn('Parse error:', err);
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
 * @param  {string} body      - Raw class body text (between the outermost braces)
 * @param  {string} className - Enclosing class name (used to recognise constructors)
 * @returns {{ fields: FieldDescriptor[], methods: MethodDescriptor[] }}
 */
function extractMembers(body, className) {
    const fields  = [];
    const methods = [];
    let depth   = 0;
    let current = '';

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
                else                       parseFieldDecl(text, fields);
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
 * @param  {string}   text - Declaration fragment to tokenize
 * @returns {string[]}       Array of tokens in source order
 */
function tokenizeSmart(text) {
    const tokens = [];
    let current = '';
    let depth   = 0;

    for (const ch of text) {
        if (ch === '<') {
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
 * Scans tokens in order, stopping at the first non-modifier token.
 * Multiple access modifiers in the same declaration are tolerated;
 * the last one encountered determines the visibility symbol.
 *
 * @param  {string[]} tokens - Token array from {@link tokenizeSmart}
 * @returns {{ visibility: string, isStatic: boolean, isFinal: boolean, isAbstract: boolean, startIndex: number }}
 *   - `visibility`  UML symbol: '+' public, '-' private, '#' protected, '~' package-private
 *   - `isStatic`    true if the 'static' keyword was present
 *   - `isFinal`     true if the 'final' keyword was present
 *   - `isAbstract`  true if the 'abstract' keyword was present
 *   - `startIndex`  index of the first non-modifier token (the type or method name)
 */
function extractModifiers(tokens) {
    let visibility = '~';   // package-private by default
    let isStatic   = false;
    let isFinal    = false;
    let isAbstract = false;
    let i = 0;

    while (i < tokens.length && MODIFIERS.has(tokens[i])) {
        switch (tokens[i]) {
            case 'public':    visibility = '+'; break;
            case 'private':   visibility = '-'; break;
            case 'protected': visibility = '#'; break;
            case 'static':    isStatic   = true; break;
            case 'final':     isFinal    = true; break;
            case 'abstract':  isAbstract = true; break;
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
 * @param  {string}            text   - Raw field declaration text (no trailing semicolon)
 * @param  {FieldDescriptor[]} fields - Accumulator array; result is pushed here
 * @returns {void}
 */
function parseFieldDecl(text, fields) {
    // Strip annotations such as @Override or @SuppressWarnings("unused").
    text = text.replace(/@\w+(?:\([^)]*\))?\s*/g, '').trim();
    if (!text) return;

    // Discard the initializer — only the type and name are relevant for UML.
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
 * @param  {string}             text      - Raw method header (no opening brace or semicolon)
 * @param  {MethodDescriptor[]} methods   - Accumulator array; result is pushed here
 * @param  {string}             className - Enclosing class name, used to identify constructors
 * @returns {void}
 */
function parseMethodDecl(text, methods, className) {
    text = text.replace(/@\w+(?:\([^)]*\))?\s*/g, '').trim();
    if (!text) return;

    // Remove the 'throws' clause — it is not shown in UML signatures.
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
 * as parameter separators. Annotations and vararg ellipses are stripped.
 *
 * @param  {string}             str - Parameter list text (without the surrounding parentheses)
 * @returns {ParamDescriptor[]}       Ordered array of parsed parameter descriptors
 */
function parseParams(str) {
    // Split on top-level commas, respecting angle brackets and parentheses.
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
            // Single token — treat it as the type with no parseable name.
            return { type: p, name: '' };
        })
        .filter(p => p.type);   // discard empty descriptors
}


// ════════════════════════════════════════════════════════════════
//  RELATIONSHIP DETECTION HELPERS
// ════════════════════════════════════════════════════════════════

/**
 * Return the base (non-generic, non-array) type name from a type string.
 *
 * @example
 * baseTypeName('List<Dog>') // → 'List'
 * baseTypeName('Dog[]')     // → 'Dog'
 *
 * @param  {string} typeStr - A Java type string, possibly including generics or arrays
 * @returns {string}          Simple base class name
 */
function baseTypeName(typeStr) {
    return typeStr.replace(/\[\]/g, '').split(/[<\s,]/)[0].trim();
}


/**
 * Return true if the base type of {@code typeStr} is a known Java collection or map type.
 *
 * Used to distinguish composition (direct field) from aggregation (collection of).
 *
 * @param  {string}  typeStr - A Java type string
 * @returns {boolean}          True when the type is a collection container
 */
function isCollectionType(typeStr) {
    return COLLECTION_TYPES.has(baseTypeName(typeStr));
}


/**
 * Extract all simple class names referenced as generic type parameters.
 *
 * Only tokens that begin with an uppercase letter are returned, which
 * heuristically identifies class names vs primitive types.
 *
 * @example
 * genericTypeRefs('Map<String, List<Dog>>') // → ['String', 'List', 'Dog']
 *
 * @param  {string}   typeStr - A Java type string potentially containing generics
 * @returns {string[]}          Uppercase-starting tokens found inside angle brackets
 */
function genericTypeRefs(typeStr) {
    const match = typeStr.match(/<(.+)>/);
    if (!match) return [];
    return match[1]
        .split(/[<>,\s]+/)
        .map(s => s.trim())
        .filter(t => /^[A-Z]/.test(t));
}


/**
 * Detect all non-inheritance UML relationships originating from a single class.
 *
 * Relationships are detected in priority order: composition → aggregation →
 * dependency «use» → dependency «creates». Once a target class is claimed by a
 * higher-priority relationship, it is not claimed again by a weaker one.
 *
 * Classes already linked by inheritance or implementation are excluded so
 * those arrows are not doubled up.
 *
 * @param  {string}         fromName - Name of the source class (key in {@link classMap})
 * @returns {Relationship[]}           Detected relationships, each with a type and target name
 */
function detectRelationships(fromName) {
    const cls    = classMap[fromName];
    const result = [];

    // Classes already covered by inheritance / implementation — skip these.
    const excluded = new Set();
    if (cls.extendsClass && classMap[cls.extendsClass]) excluded.add(cls.extendsClass);
    cls.interfaces.forEach(i => { if (classMap[i]) excluded.add(i); });

    // Claimed targets (to avoid showing two arrows for the same pair).
    const claimed = new Set();

    // ── Composition: field whose base type IS a loaded class (non-collection) ──
    cls.fields.forEach(f => {
        const base = baseTypeName(f.type);
        if (classMap[base] && base !== fromName && !excluded.has(base)
                           && !claimed.has(base) && !isCollectionType(f.type)) {
            result.push({ type: 'composition', target: base });
            claimed.add(base);
        }
    });

    // ── Aggregation: field that is a collection containing a loaded class ──
    cls.fields.forEach(f => {
        if (!isCollectionType(f.type)) return;
        genericTypeRefs(f.type).forEach(ref => {
            if (classMap[ref] && ref !== fromName && !excluded.has(ref) && !claimed.has(ref)) {
                result.push({ type: 'aggregation', target: ref });
                claimed.add(ref);
            }
        });
    });

    // ── Dependency «use»: method parameter whose base type is a loaded class ──
    cls.methods.forEach(m => {
        m.params.forEach(p => {
            const base = baseTypeName(p.type);
            if (classMap[base] && base !== fromName && !excluded.has(base) && !claimed.has(base)) {
                result.push({ type: 'depUse', target: base });
                claimed.add(base);
            }
        });
    });

    // ── Dependency «use»: body-level references to loaded classes ─────────────
    // Covers static calls (ClassName.method()), type casts ((ClassName)),
    // instanceof checks, non-constructor method references (ClassName::method),
    // catch clause types, and local variable type declarations.
    (cls.bodyUses || []).forEach(typeName => {
        const base = baseTypeName(typeName);
        if (classMap[base] && base !== fromName && !excluded.has(base) && !claimed.has(base)) {
            result.push({ type: 'depUse', target: base });
            claimed.add(base);
        }
    });

    // ── Dependency «creates»: method return type OR body instantiation ────────
    // Pass 1 — method return types (e.g. `public BankGUI createGUI()`)
    cls.methods.forEach(m => {
        if (m.isConstructor || !m.returnType) return;
        const base = baseTypeName(m.returnType);
        if (classMap[base] && base !== fromName && !excluded.has(base) && !claimed.has(base)) {
            result.push({ type: 'depCreates', target: base });
            claimed.add(base);
        }
    });

    // Pass 2 — `new ClassName(...)` calls anywhere in the class body.
    // These are not visible in method signatures, so this pass catches patterns
    // like `BankGUI gui = new BankGUI()` inside main() or any other method body.
    (cls.instantiations || []).forEach(typeName => {
        const base = baseTypeName(typeName);
        if (classMap[base] && base !== fromName && !excluded.has(base) && !claimed.has(base)) {
            result.push({ type: 'depCreates', target: base });
            claimed.add(base);
        }
    });

    return result;
}


// ════════════════════════════════════════════════════════════════
//  LEGEND — DYNAMIC RELATIONSHIP SUMMARY
// ════════════════════════════════════════════════════════════════

/**
 * Scan all loaded classes and return a Set of relationship type identifiers
 * that are actually present in the current diagram.
 *
 * Checks inheritance, implementation, and all four detected relationship
 * types so the legend shows only what exists, not a fixed full list.
 *
 * @returns {Set<string>} Any subset of:
 *   'inheritance' | 'implementation' | 'composition' | 'aggregation' | 'depUse' | 'depCreates'
 */
function computePresentRelationships() {
    const present = new Set();

    Object.keys(classMap).forEach(name => {
        const cls = classMap[name];

        if (cls.extendsClass && classMap[cls.extendsClass]) present.add('inheritance');

        cls.interfaces.forEach(ifc => {
            if (classMap[ifc]) present.add('implementation');
        });

        detectRelationships(name).forEach(rel => present.add(rel.type));
    });

    return present;
}


/**
 * Rebuild the `#legend` element to show only the relationship types that are
 * currently present in the loaded diagram.
 *
 * Each entry gets an inline SVG icon drawn directly (no marker references) so
 * that CSS custom properties always resolve correctly regardless of browser
 * quirks with SVG marker isolation. The icons accurately match the arrow
 * styles used in the diagram canvas.
 *
 * Legend entries are shown in canonical UML strength order:
 * inheritance → implementation → composition → aggregation → depUse → depCreates.
 *
 * @returns {void}
 */
function updateLegend() {
    const present = computePresentRelationships();
    const el      = document.getElementById('legend');

    /**
     * Build a 58×13 inline SVG icon for a given relationship type.
     * All shapes are drawn directly — no `<marker>` elements — so CSS
     * variables resolve reliably in all browsers.
     *
     * @param  {string} type - Relationship type identifier
     * @returns {string}       SVG element as an HTML string
     */
    function iconSVG(type) {
        const W   = 58;
        const H   = 13;
        const MID = H / 2;          // vertical centre of the icon
        const S   = 'var(--text-secondary)';   // stroke / fill colour
        const BG  = 'var(--bg-primary)';       // background fill (for hollow shapes)

        switch (type) {

            case 'inheritance':
                return `<svg width="${W}" height="${H}" overflow="visible">
                  <line x1="2" y1="${MID}" x2="40" y2="${MID}"
                        stroke="var(--arrow-inherit)" stroke-width="1.5"/>
                  <path d="M40,2 L51,${MID} L40,11 Z"
                        fill="${BG}" stroke="var(--arrow-inherit)" stroke-width="1.2"
                        stroke-linejoin="round"/>
                </svg>`;

            case 'implementation':
                return `<svg width="${W}" height="${H}" overflow="visible">
                  <line x1="2" y1="${MID}" x2="40" y2="${MID}"
                        stroke="var(--arrow-impl)" stroke-width="1.2" stroke-dasharray="4 2"/>
                  <path d="M40,2 L51,${MID} L40,11 Z"
                        fill="${BG}" stroke="var(--arrow-impl)" stroke-width="1.2"
                        stroke-linejoin="round"/>
                </svg>`;

            case 'composition':
                return `<svg width="${W}" height="${H}" overflow="visible">
                  <polygon points="2,${MID} 10,2 18,${MID} 10,11"
                           fill="var(--arrow-comp)" opacity="0.85"/>
                  <line x1="18" y1="${MID}" x2="${W - 2}" y2="${MID}"
                        stroke="var(--arrow-comp)" stroke-width="1.4"/>
                </svg>`;

            case 'aggregation':
                return `<svg width="${W}" height="${H}" overflow="visible">
                  <polygon points="2,${MID} 10,2 18,${MID} 10,11"
                           fill="${BG}" stroke="var(--arrow-agg)" stroke-width="1.2"
                           stroke-linejoin="round"/>
                  <line x1="18" y1="${MID}" x2="${W - 2}" y2="${MID}"
                        stroke="var(--arrow-agg)" stroke-width="1.2"/>
                </svg>`;

            case 'depUse':
                return `<svg width="${W}" height="${H}" overflow="visible">
                  <line x1="2" y1="${MID}" x2="42" y2="${MID}"
                        stroke="var(--arrow-dep-use)" stroke-width="1.1"
                        stroke-dasharray="5 2"/>
                  <path d="M41,2.5 L51,${MID} L41,10.5"
                        fill="none" stroke="var(--arrow-dep-use)" stroke-width="1.3"
                        stroke-linecap="round" stroke-linejoin="round"/>
                </svg>`;

            case 'depCreates':
                return `<svg width="${W}" height="${H}" overflow="visible">
                  <line x1="2" y1="${MID}" x2="42" y2="${MID}"
                        stroke="var(--arrow-dep-create)" stroke-width="1.1"
                        stroke-dasharray="8 2"/>
                  <path d="M41,2.5 L51,${MID} L41,10.5"
                        fill="none" stroke="var(--arrow-dep-create)" stroke-width="1.3"
                        stroke-linecap="round" stroke-linejoin="round"/>
                </svg>`;

            default:
                return '';
        }
    }

    /**
     * Human-readable label for each relationship type.
     * Guillemets are fine here — this is HTML context, not SVG monospace.
     *
     * @type {Object.<string, string>}
     */
    const LABELS = {
        inheritance:    'extends',
        implementation: 'implements',
        composition:    'composition',
        aggregation:    'aggregation',
        depUse:         '«use»',
        depCreates:     '«creates»',
    };

    /** Canonical display order — strongest relationship type first. */
    const ORDER = ['inheritance', 'implementation', 'composition', 'aggregation', 'depUse', 'depCreates'];

    el.innerHTML = ORDER
        .filter(type => present.has(type))
        .map(type => `
            <div class="legend-row">
                ${iconSVG(type)}
                <span>${LABELS[type]}</span>
            </div>`)
        .join('');
}

/**
 * Format a {@link FieldDescriptor} as a UML attribute string.
 *
 * Format: {@code <visibility>[/]<n> : <type>}
 * The '/' prefix marks a static (class-level) attribute per UML 2 conventions.
 *
 * @param  {FieldDescriptor} f - Field to format
 * @returns {string}             UML attribute string, e.g. {@code "+ /MAX_SIZE : int"}
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
 * Format: {@code <visibility>[/][~]<n>(<paramTypes>) [: <returnType>]}
 * - '/' prefix marks a static operation.
 * - '~' prefix marks an abstract operation.
 * - Constructors omit the return type suffix.
 *
 * @param  {MethodDescriptor} m - Method to format
 * @returns {string}              UML operation string, e.g. {@code "+ findAll(String) : List<User>"}
 */
function methodToString(m) {
    let s = m.visibility + ' ';
    if (m.isStatic)   s += '/';
    if (m.isAbstract) s += '~';
    const params = m.params.map(p => p.type).join(', ');
    s += m.name + '(' + params + ')';
    if (m.returnType) s += ' : ' + m.returnType;
    return s;
}


/**
 * Escape a value for safe embedding in XML/SVG text content or attribute values.
 *
 * Replaces the five XML special characters: {@code & < > " '}
 *
 * @param  {*}      s - Value to escape (coerced to string via String())
 * @returns {string}    XML-safe string
 */
function escapeXml(s) {
    return String(s)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&apos;');
}


// ════════════════════════════════════════════════════════════════
//  BOX DIMENSIONS
// ════════════════════════════════════════════════════════════════

/**
 * Return only the fields that should currently be rendered,
 * based on the {@link visMembers} flag.
 *
 * @param  {ClassDescriptor} cls - The class whose fields are filtered
 * @returns {FieldDescriptor[]}    Fields to display (may be empty)
 */
function visibleFields(cls) {
    return visMembers.fields ? cls.fields : [];
}


/**
 * Return only the methods that should currently be rendered,
 * respecting both the `methods` and `constructors` flags in {@link visMembers}.
 *
 * @param  {ClassDescriptor} cls - The class whose methods are filtered
 * @returns {MethodDescriptor[]}   Methods to display (may be empty)
 */
function visibleMethods(cls) {
    if (!visMembers.methods) return [];
    return cls.methods.filter(m => visMembers.constructors || !m.isConstructor);
}


/**
 * Recompute and cache box dimensions for every loaded class without
 * touching positions. Called when {@link visMembers} changes so that
 * box heights immediately reflect which member rows are now shown.
 *
 * @returns {void}
 */
function refreshDims() {
    Object.keys(classMap).forEach(n => {
        dims[n] = calcDimensions(classMap[n]);
    });
}


/**
 * Render one field as a `<text>` SVG element with per-part `<tspan>` coloring.
 *
 * Parts and their CSS variable:
 * - Visibility symbol (+, -, #, ~): `--uml-vis`
 * - Static modifier (/):            `--uml-mod`
 * - Field identifier:               `--uml-name`
 * - Colon separator ( : ):          `--uml-sep`
 * - Declared type:                  `--uml-type`
 *
 * Falls back to a single plain truncated text element when the full string
 * would exceed {@code MAX_CHARS} characters, avoiding complex tspan truncation.
 *
 * @param  {FieldDescriptor} f    - Field to render
 * @param  {number}          x    - Left edge x coordinate
 * @param  {number}          y    - Baseline y coordinate
 * @param  {number}          maxW - Available pixel width (used for char estimate)
 * @returns {string}               SVG `<text>` element markup
 */
function renderFieldText(f, x, y, maxW) {
    const MAX_CHARS = Math.floor(maxW / CHAR_W);
    const full      = fieldToString(f);

    if (full.length > MAX_CHARS) {
        const cut = full.substring(0, MAX_CHARS - 1) + '…';
        return `<text x="${x}" y="${y}" font-family="monospace" font-size="11"
                      fill="var(--uml-field-name)">${escapeXml(cut)}</text>`;
    }

    const vis = f.visibility + ' ';
    const mod = f.isStatic ? '/' : '';

    return `<text x="${x}" y="${y}" font-family="monospace" font-size="11"
                  xml:space="preserve"
            ><tspan fill="var(--uml-vis)">${escapeXml(vis)}</tspan
            >${mod ? `<tspan fill="var(--uml-mod)">${escapeXml(mod)}</tspan>` : ''
            }<tspan fill="var(--uml-field-name)">${escapeXml(f.name)}</tspan
            ><tspan fill="var(--uml-sep)"> : </tspan
            ><tspan fill="var(--uml-type)">${escapeXml(f.type)}</tspan
            ></text>`;
}


/**
 * Render one method as a `<text>` SVG element with per-part `<tspan>` coloring.
 *
 * Parts and their CSS variable:
 * - Visibility symbol:              `--uml-vis`
 * - Static (/) and abstract (~):    `--uml-mod`
 * - Method identifier:              `--uml-name`
 * - Parentheses and colon:          `--uml-sep`
 * - Parameter types and return type:`--uml-type`
 *
 * Constructors are rendered at 60% opacity to visually distinguish them.
 * Falls back to plain truncated text when the line would be too long.
 *
 * @param  {MethodDescriptor} m    - Method to render
 * @param  {number}           x    - Left edge x coordinate
 * @param  {number}           y    - Baseline y coordinate
 * @param  {number}           maxW - Available pixel width (used for char estimate)
 * @returns {string}                SVG `<text>` element markup
 */
function renderMethodText(m, x, y, maxW) {
    const MAX_CHARS = Math.floor(maxW / CHAR_W);
    const full      = methodToString(m);
    const nameColor = m.isConstructor ? 'var(--uml-ctor-name)' : 'var(--uml-method-name)';
    const opacity   = '1';   // opacity now carried by the color variables, not fill-opacity

    if (full.length > MAX_CHARS) {
        const cut = full.substring(0, MAX_CHARS - 1) + '…';
        return `<text x="${x}" y="${y}" font-family="monospace" font-size="11"
                      fill="${nameColor}">${escapeXml(cut)}</text>`;
    }

    const vis    = m.visibility + ' ';
    const mods   = (m.isStatic ? '/' : '') + (m.isAbstract ? '~' : '');
    const params = m.params.map(p => p.type).join(', ');

    return `<text x="${x}" y="${y}" font-family="monospace" font-size="11"
                  xml:space="preserve"
            ><tspan fill="var(--uml-vis)">${escapeXml(vis)}</tspan
            >${mods ? `<tspan fill="var(--uml-mod)">${escapeXml(mods)}</tspan>` : ''
            }<tspan fill="${nameColor}">${escapeXml(m.name)}</tspan
            ><tspan fill="var(--uml-sep)">(</tspan
            ><tspan fill="var(--uml-type)">${escapeXml(params)}</tspan
            ><tspan fill="var(--uml-sep)">)</tspan
            >${m.returnType ? `<tspan fill="var(--uml-sep)"> : </tspan><tspan fill="var(--uml-type)">${escapeXml(m.returnType)}</tspan>` : ''
            }</text>`;
}


/**
 * Compute the pixel dimensions of the UML box for a given class descriptor.
 *
 * Width is clamped to [{@link MIN_W}, {@link MAX_W}].
 * Height is header + field section + method section, each with padding.
 *
 * @param  {ClassDescriptor} cls - Class whose box dimensions are needed
 * @returns {BoxDimensions}        Computed { w, h, fh }
 */
function calcDimensions(cls) {
    const fields  = visibleFields(cls);
    const methods = visibleMethods(cls);
    const nameW   = cls.name.length * 9.5 + H_PAD * 2;
    const allTexts = [
        ...fields.map(fieldToString),
        ...methods.map(methodToString)
    ];
    const contentW = allTexts.length
        ? Math.max(...allTexts.map(t => t.length * CHAR_W)) + H_PAD * 2
        : MIN_W;

    const w  = Math.min(MAX_W, Math.max(MIN_W, nameW, contentW));
    const fh = fields.length  ? V_PAD + fields.length  * LINE_H + V_PAD : SEC_MIN;
    const mh = methods.length ? V_PAD + methods.length * LINE_H + V_PAD : SEC_MIN;
    const h  = HEADER_H + 1 + fh + 1 + mh;

    return { w, h, fh };
}


// ════════════════════════════════════════════════════════════════
//  SECTIONS
// ════════════════════════════════════════════════════════════════

/**
 * Build SVG markup for all canvas sections.
 *
 * Each section is drawn as a rounded rectangle that auto-fits around all
 * class boxes assigned to it, plus a fixed padding. The label is placed in
 * the top-left corner of the rectangle. Sections with no assigned classes
 * (or no positioned boxes) are silently skipped.
 *
 * Sections are drawn before arrows and class boxes so they appear as a
 * background layer.
 *
 * @returns {string} Concatenated SVG elements as an HTML string fragment
 */
function renderSections() {
    const PAD       = 20;   // padding around class boxes inside the section
    const LABEL_H   = 20;   // vertical space reserved for the label above the boxes
    let svg = '';
 
    sections.forEach((sec, idx) => {
        const fill   = SECTION_PALETTE[idx % SECTION_PALETTE.length];
        const stroke = SECTION_BORDER[idx % SECTION_BORDER.length];
 
        // Collect positions of all assigned, positioned classes.
        const assigned = Object.keys(sectionAssignments).filter(
            n => sectionAssignments[n] === sec.id && positions[n] && dims[n]
        );
        if (!assigned.length) return;
 
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        assigned.forEach(n => {
            const p = positions[n], d = dims[n];
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x + d.w);
            maxY = Math.max(maxY, p.y + d.h);
        });
 
        const rx = minX - PAD;
        const ry = minY - PAD - LABEL_H;
        const rw = (maxX - minX) + PAD * 2;
        const rh = (maxY - minY) + PAD * 2 + LABEL_H;
 
        // Background rectangle
        svg += `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="8"
                      fill="${fill}"
                      stroke="${stroke}" stroke-width="1.2"/>`;
 
        // Label
        svg += `<text x="${rx + 10}" y="${ry + LABEL_H * 0.72}"
                      font-family="sans-serif" font-size="11" font-weight="600"
                      fill="${stroke.replace('0.45', '0.85')}">${escapeXml(sec.name)}</text>`;
 
        // Thin separator line below the label
        svg += `<line x1="${rx + 6}" y1="${ry + LABEL_H}"
                      x2="${rx + rw - 6}" y2="${ry + LABEL_H}"
                      stroke="${stroke}" stroke-width="0.5"/>`;
    });
 
    return svg;
}


/**
 * Add a new section with the name currently typed in the sidebar input.
 *
 * If the name is empty or whitespace-only, the call is silently ignored.
 * The input is cleared after a successful add.
 *
 * @returns {void}
 */
function addSection() {
    const input = document.getElementById('section-name-input');
    const name = input.value.trim();
    if (!name) return;

    const id = `sec_${Date.now()}`;
    sections.push({ id, name });
    input.value = '';
    updateSectionList();
    // Also update file-list so the new section appears in each class dropdown.
    updateFileList();
    render();
}


/**
 * Delete a section by id, unassigning all classes that belonged to it.
 *
 * @param  {string} id - Section id to delete
 * @returns {void}
 */
function deleteSection(id) {
    sections = sections.filter(s => s.id !== id);
    Object.keys(sectionAssignments).forEach(cls => {
        if (sectionAssignments[cls] === id) sectionAssignments[cls] = null;
    });
    updateSectionList();
    updateFileList();
    render();
}


/**
 * Rename a section in response to an inline edit in the sidebar.
 *
 * @param  {string} id   - Section id to rename
 * @param  {string} name - New name (trimmed by the caller)
 * @returns {void}
 */
function renameSection(id, name) {
    const sec = sections.find(s => s.id === id);
    if (sec) { sec.name = name; render(); }
}


/**
 * Assign or unassign a class to a section.
 *
 * @param  {string}      className - Class name key in {@link classMap}
 * @param  {string|null} sectionId - Section id to assign, or '' / null to unassign
 * @returns {void}
 */
function assignClassToSection(className, sectionId) {
    sectionAssignments[className] = sectionId || null;
    render();
}


/**
 * Rebuild the section list in the sidebar from the current {@link sections} array.
 *
 * Each row shows a color swatch, an editable name input, and a delete button.
 *
 * @returns {void}
 */
function updateSectionList() {
    const list = document.getElementById('section-list');
    list.innerHTML = sections.map((sec, idx) => {
        const swatch = SECTION_BORDER[idx % SECTION_BORDER.length];
        return `
        <div class="section-item">
            <span class="section-swatch" style="background:${swatch}"></span>
            <input class="section-item-name"
                   type="text"
                   value="${escapeXml(sec.name)}"
                   onchange="renameSection('${sec.id}', this.value.trim())"
                   title="Click to rename" />
            <button class="section-delete-btn"
                    onclick="deleteSection('${sec.id}')"
                    title="Delete section">×</button>
        </div>`;
    }).join('');
}


// ════════════════════════════════════════════════════════════════
//  AUTO-LAYOUT
// ════════════════════════════════════════════════════════════════

/**
 * Assign canvas positions to all loaded classes using a depth-based hierarchical layout.
 *
 * Only assigns positions for classes that have not been manually dragged.
 * Side effects: populates {@link positions} and {@link dims}.
 *
 * @returns {void}
 */
function autoLayout() {
    const names = Object.keys(classMap);
    if (!names.length) return;

    // ── Step 1: depth assignment via cycle-safe DFS ──────────────────────
    const levelMap = {};

    /**
     * Recursively determine the inheritance depth of a single class.
     *
     * @param  {string}      name - Class name to resolve
     * @param  {Set<string>} seen - Names on the current DFS stack (cycle guard)
     * @returns {number}           Depth (0 = root / no known parent in classMap)
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

    // ── Step 2: group classes by depth level ─────────────────────────────
    /** @type {Object.<number, string[]>} */
    const byLevel = {};
    names.forEach(n => {
        const lvl = levelMap[n] || 0;
        if (!byLevel[lvl]) byLevel[lvl] = [];
        byLevel[lvl].push(n);
    });

    const GAP_X    = 40;
    const GAP_Y    = 80;
    const CANVAS_W = 900;

    // ── Step 3: compute Y origin for each row ────────────────────────────
    let cumulY = 20;
    /** @type {Object.<number, number>} Level index → Y coordinate. */
    const levelY = {};

    Object.entries(byLevel)
        .sort(([a], [b]) => +a - +b)
        .forEach(([lvl, classNames]) => {
            levelY[lvl] = cumulY;
            const maxH = Math.max(...classNames.map(n => calcDimensions(classMap[n]).h));
            cumulY += maxH + GAP_Y;
        });

    // ── Step 4: position boxes within each row, centred on CANVAS_W ─────
    Object.entries(byLevel).forEach(([lvl, classNames]) => {
        const dList  = classNames.map(n => calcDimensions(classMap[n]));
        const totalW = dList.reduce((sum, d) => sum + d.w, 0) + (classNames.length - 1) * GAP_X;
        let x = Math.max(20, (CANVAS_W - totalW) / 2);

        classNames.forEach((name, i) => {
            if (!positions[name]) positions[name] = { x, y: levelY[lvl] };
            dims[name] = dList[i];
            x += dList[i].w + GAP_X;
        });
    });

    // Ensure dims are cached for boxes that already had a manual position.
    names.forEach(n => { if (!dims[n]) dims[n] = calcDimensions(classMap[n]); });
}


// ════════════════════════════════════════════════════════════════
//  RENDERING
// ════════════════════════════════════════════════════════════════

/**
 * Determine which pair of box edges a connection should use.
 * 
 * Compares center-to-center deltas. When the vertical delta dominates the
 * connection exits via top/bottom edges; otherwise vie left/right edges.
 * The same logic is run for both endpoints so the edge assignments are
 * always consistent regardless of which class is "from" and which is "to".
 * 
 * @param {Position} fp - Top-left position of the source box
 * @param {BoxDimensions} fd - Dimensions of the source box
 * @param {Position} tp - Top-left position of the target box
 * @param {BoxDimensions} td - Dimensions of the target box
 * @returns {{ fromEdge: string, toEdge: string }}
 *   Each value is one of: 'top' | 'bottom' | 'left' | 'right'
 */
function computeEdge(fp, fd, tp, td) {
    const dx = (tp.x + td.w / 2) - (fp.x + fd.w / 2);
    const dy = (tp.y + td.h / 2) - (fp.y + fd.h / 2);

    if (Math.abs(dy) >= Math.abs(dx)) {
        return {
            fromEdge: dy < 0 ? 'top' : 'bottom',
            toEdge: dy < 0 ? 'bottom' : 'top',
        };
    }
    return {
        fromEdge: dx < 0 ? 'left' : 'right',
        toEdge: dx < 0 ? 'right' : 'left',
    };
}


/**
 * Compute a single contact point on a box edge, evenly spaced among all
 * arrows that share that edge.
 *
 * The fraction along the edge is `(slotIdx + 1) / (slotTotal + 1)`, which
 * distributes N arrows into N equal sections with a margin at each corner.
 * A single arrow defaults to the centre (fraction 0.5).
 *
 * @param  {Position}      pos       - Top-left position of the box
 * @param  {BoxDimensions} dim       - Dimensions of the box
 * @param  {string}        edge      - 'top' | 'bottom' | 'left' | 'right'
 * @param  {number}        slotIdx   - Zero-based index of this arrow within the edge group
 * @param  {number}        slotTotal - Total number of arrows on this edge
 * @returns {{ x: number, y: number }}  Absolute SVG coordinate of the contact point
 */
function computeContactPoint(pos, dim, edge, slotIdx, slotTotal) {
    const frac = (slotIdx + 1) / (slotTotal + 1);
    switch (edge) {
        case 'top':     return { x: pos.x + dim.w * frac, y: pos.y };
        case 'bottom':  return { x: pos.x + dim.w * frac, y: pos.y + dim.h };
        case 'left':    return { x: pos.x,                y: pos.y + dim.h * frac };
        case 'right':   return { x: pos.x + dim.w,        y: pos.y + dim.h * frac };
    }
}


/**
 * Build an SVG path data string (intermediate waypoints only) for the elbow
 * between two contact points, with snap-to-straight behaviour and user offsets.
 *
 * **Snap-to-straight:** if the contact points are within {@code STRAIGHT_SNAP}
 * pixels perpendicular to the route axis, the arrow is drawn as a straight
 * diagonal line (no elbow segment returned). This keeps short connections clean.
 *
 * **Stagger:** when multiple arrows share the same source edge, their natural
 * midpoints are offset by ±(slotIdx − centre) × ELBOW_STEP so they separate.
 *
 * **User offset:** the value stored in {@link bendOffsets} for this arrow is
 * added on top of the natural midpoint, letting the user push the bend anywhere.
 *
 * **Axis invalidation:** if the routing axis has changed since the last render
 * (box dragged from a top/bottom route to a left/right route or vice-versa),
 * the user offset is discarded so a stale horizontal offset is not applied to
 * a newly vertical route.
 *
 * @param  {{ x:number, y:number }} from      - Source contact point
 * @param  {string}                 fromEdge  - Source edge name ('top'|'bottom'|'left'|'right')
 * @param  {{ x:number, y:number }} to        - Target contact point
 * @param  {string}                 toEdge    - Target edge name (for symmetry / future use)
 * @param  {number}                 slotIdx   - Zero-based index of this arrow on the source edge
 * @param  {number}                 slotTotal - Total arrows on the source edge
 * @param  {string}                 bendKey   - Unique key identifying this arrow in {@link bendOffsets}
 * @returns {{ path: string, bendPt: {x:number, y:number}|null }}
 *   - `path`   SVG path data for the waypoints (empty string = straight line)
 *   - `bendPt` World coordinates of the bend handle, or null for straight arrows
 */
function buildElbowPath(from, fromEdge, to, toEdge, slotIdx, slotTotal, bendKey) {
    const ELBOW_STEP    = 14;   // px between parallel staggered elbows
    const STRAIGHT_SNAP = 20;   // px perpendicular threshold — snap to straight below this
 
    const isVertical = fromEdge === 'top' || fromEdge === 'bottom';
    const axis       = isVertical ? 'vertical' : 'horizontal';
 
    // Invalidate user offset when routing axis has flipped since last render.
    if (bendEdgeCache[bendKey] && bendEdgeCache[bendKey] !== axis) {
        delete bendOffsets[bendKey];
    }
    bendEdgeCache[bendKey] = axis;
 
    const stagger    = (slotIdx - (slotTotal - 1) / 2) * ELBOW_STEP;
    const userOffset = bendOffsets[bendKey] || 0;
 
    if (isVertical) {
        // Snap to straight when endpoints are already close horizontally.
        if (Math.abs(from.x - to.x) < STRAIGHT_SNAP && userOffset === 0) {
            return { path: '', bendPt: null };
        }
        const midY    = (from.y + to.y) / 2 + stagger + userOffset;
        const bendPt  = { x: (from.x + to.x) / 2, y: midY };
        return { path: `L${from.x},${midY} L${to.x},${midY}`, bendPt };
    } else {
        // Snap to straight when endpoints are already close vertically.
        if (Math.abs(from.y - to.y) < STRAIGHT_SNAP && userOffset === 0) {
            return { path: '', bendPt: null };
        }
        const midX    = (from.x + to.x) / 2 + stagger + userOffset;
        const bendPt  = { x: midX, y: (from.y + to.y) / 2 };
        return { path: `L${midX},${from.y} L${midX},${to.y}`, bendPt };
    }
}


/**
 * Build SVG markup for a stereotype label centred on a relationship arrow.
 *
 * The label is placed at the visual midpoint of the elbow path so it sits
 * near the bend rather than at the straight-line midpoint between endpoints.
 * Uses ASCII angle-bracket notation (`<<use>>`) for cross-platform glyph
 * reliability, and sans-serif to maximise coverage.
 *
 * @param  {{ x:number, y:number }} from  - Source contact point
 * @param  {{ x:number, y:number }} to    - Target contact point
 * @param  {string}                 label - Label text, e.g. '<<use>>'
 * @param  {string}                 color - CSS color value for the text fill
 * @returns {string}                        SVG {@code <text>} element markup
 */
function renderArrowLabel(from, to, bendPt, label, color) {
    const mx = bendPt ? bendPt.x : (from.x + to.x) / 2;
    const my = (bendPt ? bendPt.y : (from.y + to.y) / 2) - 6;
    return `<text x="${mx}" y="${my}"
                    text-anchor="middle"
                    font-family="sans-serif" font-size="9"
                    fill="${color}" fill-opacity="0.90">${escapeXml(label)}</text>`;
}


/**
 * Build and draw all relationship arrows for the current diagram.
 *
 * The pipeline has five phases:
 *
 * **Stage 1 — Collect** raw connections from {@link detectRelationships},
 * implemented interfaces, and the superclass chain.
 *
 * **Stage 2 — Merge** bidirectional pairs. When class A and class B both
 * have a composition (or aggregation) relationship pointing at each other,
 * the two arrows are collapsed into one with markers at both ends. This
 * avoids drawing two overlapping lines for mutual ownership patterns.
 * Only structural relationship types (composition, aggregation) are merged;
 * dependency arrows are always unidirectional.
 *
 * **Stage 3 — Assign edges**. For each connection, {@link computeEdge}
 * determines which pair of box edges to connect based on the centre-to-centre
 * direction vector. Since the same logic runs for every arrow, edges are
 * consistent even after boxes are dragged.
 *
 * **Stage 4 — Slot assignment**. Connections are grouped by `className-edge`
 * key. Within each group every connection is assigned an integer slot index
 * (0…n-1). {@link computeContactPoint} then maps each index to an evenly
 * spaced position along the edge so no two arrows share the same anchor point.
 *
 * **Stage 5 — Draw**. Arrows are drawn in increasing visual strength order
 * (weakest first, strongest last) so stronger lines appear on top.
 * {@link buildElbowPath} staggers parallel elbows so they separate visually.
 *
 * @returns {string} Concatenated SVG elements as an HTML string fragment
 */
function renderArrows() {

    // Stage 1: collect raw connections

    /**
     * @typedef     {Object}    RawConn
     * @property    {string}    fromName - Source class name
     * @property    {string}    toName   - Target class name
     * @property    {string}    relType  - Relationship type identifier
     * @property    {boolean}   bidir    - True when this is a merged bidirectional arrow
     */

    /** @type {RawConn[]} */
    const rawConns = [];

    Object.keys(classMap).forEach(fromName => {
        const cls = classMap[fromName];
        if (!positions[fromName] || !dims[fromName]) return;

        // Structural & dependency relationship (weakest - drawn first)
        detectRelationships(fromName).forEach(rel => {
            if (!visRelationships[rel.type]) return;
            if (!positions[rel.target] || !dims[rel.target]) return;
            rawConns.push({ fromName, toName: rel.target, relType: rel.type, bidir: false });
        });

        // Implementation - medium strength
        cls.interfaces.forEach(ifc => {
            if (!classMap[ifc] || !positions[ifc] || !dims[ifc]) return;
            rawConns.push({ fromName, toName: ifc, relType: 'implementation', bidir: false });
        });

        // Inheritance - strongest, drawn on top
        if (cls.extendsClass && classMap[cls.extendsClass]
                && positions[cls.extendsClass] && dims[cls.extendsClass]) {
            rawConns.push({ fromName, toName: cls.extendsClass, relType: 'inheritance', bidir: false });
        }
    });

    // Stage 2: merge bidirectional structural pairs

    const MERGABLE = new Set(['composition', 'aggregation']);
    const mergedAway = new Set();  // indices of rawConns that were absorbed
    /** @type {RawConn[]} */
    const connections = [];

    rawConns.forEach((conn, i) => {
        if (mergedAway.has(i)) return;

        if (MERGABLE.has(conn.relType)) {
            // Search forward for the reverse connection of the same type.
            const revIdx = rawConns.findIndex((r, j) =>
                j > i
                && !mergedAway.has(j)
                && r.relType === conn.relType
                && r.fromName === conn.toName
                && r.toName === conn.fromName
            );

            if (revIdx !== -1) {
                // Found a matching reverse - merge both into one bidirectional entry.
                mergedAway.add(revIdx);
                connections.push({ ...conn, bidir: true});
                return;
            }
        }

        connections.push({ ...conn, bidir: false});
    });

    // ── Stage 3: assign edges ─────────────────────────────────────────────────

    connections.forEach(conn => {
        const { fromEdge, toEdge } = computeEdge(
            positions[conn.fromName], dims[conn.fromName],
            positions[conn.toName], dims[conn.toName]
        );
        conn.fromEdge = fromEdge;
        conn.toEdge = toEdge;
    });

    // ── Stage 4: slot assignment ──────────────────────────────────────────────
    // Build a map from "className-edge" to all connections that touch that edge,
    // then assign each connection its index within that group.
    //
    // Each connection occupies exactly ONE slot on the from-class edge and
    // ONE slot on the to-class edge, regardless of whether it is bidirectional.

    /**
     * Edge group map: key is "className-edge", value is array of connection indices
     * that have an endpoint on that edge.
     * @type {Object.<string, Array<{idx:number, end:'from'|'to'}>>}
     */
    const edgeGroups = {};

    connections.forEach((conn, i) => {
        const fk = `${conn.fromName}-${conn.fromEdge}`;
        const tk = `${conn.toName}-${conn.toEdge}`;
        (edgeGroups[fk] = edgeGroups[fk] || []).push({ idx: i, end: 'from' });
        (edgeGroups[tk] = edgeGroups[tk] || []).push({ idx: i, end: 'to'   });
    });
 
    // Sort each edge group so slot positions correspond to the spatial positions
    // of the connected boxes — minimises line crossings.
    // Top/bottom edges sort by the X centre of the other box.
    // Left/right edges sort by the Y centre of the other box.
    Object.entries(edgeGroups).forEach(([key, group]) => {
        const edge    = key.split('-').pop();
        const isHoriz = edge === 'top' || edge === 'bottom';
 
        group.sort((a, b) => {
            const connA  = connections[a.idx];
            const connB  = connections[b.idx];
            const nameA  = a.end === 'from' ? connA.toName   : connA.fromName;
            const nameB  = b.end === 'from' ? connB.toName   : connB.fromName;
            const pA = positions[nameA], dA = dims[nameA];
            const pB = positions[nameB], dB = dims[nameB];
            if (!pA || !pB) return 0;
            return isHoriz
                ? (pA.x + dA.w / 2) - (pB.x + dB.w / 2)
                : (pA.y + dA.h / 2) - (pB.y + dB.h / 2);
        });
    });
 
    connections.forEach((conn, i) => {
        const fk     = `${conn.fromName}-${conn.fromEdge}`;
        const tk     = `${conn.toName}-${conn.toEdge}`;
        const fGroup = edgeGroups[fk];
        const tGroup = edgeGroups[tk];
 
        conn.fromSlotIdx   = fGroup.findIndex(e => e.idx === i && e.end === 'from');
        conn.fromSlotTotal = fGroup.length;
        conn.toSlotIdx     = tGroup.findIndex(e => e.idx === i && e.end === 'to');
        conn.toSlotTotal   = tGroup.length;
    });

    // Stage 5: draw

    let svg = '';

    connections.forEach(conn => {
        const fp = positions[conn.fromName], fd = dims[conn.fromName];
        const tp = positions[conn.toName], td = dims[conn.toName];
        
        const from = computeContactPoint(fp, fd, conn.fromEdge, conn.fromSlotIdx, conn.fromSlotTotal);
        const to = computeContactPoint(tp, td, conn.toEdge, conn.toSlotIdx, conn.toSlotTotal);
        
        // Build a stable key for this connection's bend offset and edge cache
        const bendKey = `${conn.fromName}::${conn.toName}::${conn.relType}`;

        const { path: elbowPath, bendPt } = buildElbowPath(
            from, conn.fromEdge, to, conn.toEdge,
            conn.fromSlotIdx, conn.fromSlotTotal,
            bendKey
        );

        const d = `M${from.x},${from.y} ${elbowPath} L${to.x},${to.y}`;

        switch (conn.relType) {

            case 'composition':
                // Bidirectional: diamond at both ends.
                // Unidirectional: filled diamond at owner (source), plain end at part.
                if (conn.bidir) {
                    svg += `<path d="${d}" fill="none" stroke="var(--arrow-comp)" stroke-width="1.4"
                                    marker-start="url(#m-comp)" marker-end="url(#m-comp)"/>`;
                } else {
                    svg += `<path d="${d}" fill="none" stroke="var(--arrow-comp)" stroke-width="1.4"
                                    marker-start="url(#m-comp)"/>`;
                }
                break;

            case 'aggregation':
                // Bidirectional: hollow diamond at both ends.
                // Unidirectional: hollow diamond at owner (source), plain end at part.
                if (conn.bidir) {
                    svg += `<path d="${d}" fill="none" stroke="var(--arrow-agg)" stroke-width="1.2"
                                    marker-start="url(#m-agg)" marker-end="url(#m-agg)"/>`;
                } else {
                    svg += `<path d="${d}" fill="none" stroke="var(--arrow-agg)" stroke-width="1.2"
                                    marker-start="url(#m-agg)"/>`;
                }
                break;

            case 'depUse':
                // Short-dashed blue line, open arrowhead at target, <<use>> label.
                svg += `<path d="${d}" fill="none" stroke="var(--arrow-dep-use)" stroke-width="1.1"
                                stroke-dasharray="6 3" marker-end="url(#m-dep)"/>`;
                svg += renderArrowLabel(from, to, bendPt, '<<use>>', 'var(--arrow-dep-use)');
                break;

            case 'depCreates':
                // Long-dashed green line, open arrowhead, <<creates>> label.
                svg += `<path d="${d}" fill="none" stroke="var(--arrow-dep-create)" stroke-width="1.1"
                                stroke-dasharray="9 3" marker-end="url(#m-dep)"/>`;
                svg += renderArrowLabel(from, to, bendPt, '<<creates>>', 'var(--arrow-dep-create)');
                break;

            case 'implementation':
                // Dashed line + hollow triangle arrowhead at interface end.
                svg += `<path d="${d}" fill="none" stroke="var(--arrow-impl)" stroke-width="1.2"
                                stroke-dasharray="6 3" marker-end="url(#m-impl)"/>`;
                break;

            case 'inheritance':
                // Solid line + hollow triangle arrowhead at superclass end.
                svg += `<path d="${d}" fill="none" stroke="var(--arrow-inherit)" stroke-width="1.5"
                                marker-end="url(#m-inh)"/>`;
                break;
        }

        // Render the draggable bend handle for elbowed arrows.
        // The handle is a small circle at the bend midpoint. It is invisible by
        // default and appears on #diagram hover via CSS. Dragging it updates
        // bendOffsets[bendKey] so future renders move the elbow accordingly.
        if (bendPt) {
            svg += `<circle class="bend-handle"
                            cx="${bendPt.x}" cy="${bendPt.y}" r="5"
                            data-bend-key="${escapeXml(bendKey)}"
                            data-bend-axis="${(conn.fromEdge === 'top' || conn.fromEdge === 'bottom') ? 'vertical' : 'horizontal'}"/>`;
        }
    });

    return svg;
}


/**
 * Return the header fill and text color CSS variable strings for a class descriptor.
 *
 * @param  {ClassDescriptor} cls - Class whose header style is needed
 * @returns {HeaderColors}         CSS value strings for fill and text
 */
function headerColors(cls) {
    if (cls.type === 'interface') return { fill: 'var(--hdr-interface)', text: 'var(--hdr-interface-text)' };
    if (cls.type === 'enum')      return { fill: 'var(--hdr-enum)',      text: 'var(--hdr-enum-text)'      };
    if (cls.isAbstract)           return { fill: 'var(--hdr-abstract)',  text: 'var(--hdr-abstract-text)'  };
    return                               { fill: 'var(--hdr-class)',     text: 'var(--hdr-class-text)'     };
}


/**
 * Build SVG markup for a single UML class box.
 *
 * Three horizontal sections: header / fields / methods, separated by hairlines.
 * The selected class receives a thicker accent-coloured border.
 * Text exceeding 38 characters is truncated with an ellipsis.
 *
 * @param  {string} name - Key in {@link classMap} identifying the class to render
 * @returns {string}       SVG {@code <g>} element, or '' if not yet positioned
 */
function renderBox(name) {
    const cls = classMap[name];
    const pos = positions[name];
    const dim = dims[name];
    if (!pos || !dim) return '';

    const { x, y }     = pos;
    const { w, h, fh } = dim;
    const hc            = headerColors(cls);
    const isSelected    = (selectedClass === name);

    const strokeW = isSelected ? 2     : 0.5;
    const strokeC = isSelected ? 'var(--accent)' : 'var(--text-primary)';
    const strokeO = isSelected ? 0.9   : 0.25;

    let svg = `<g data-class="${escapeXml(name)}" class="uml-box">`;

    // ── Outer box shell ──────────────────────────────────────────────────────
    svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"
                 style="fill:var(--bg-primary)"
                 stroke="${strokeC}" stroke-width="${strokeW}" stroke-opacity="${strokeO}"/>`;

    // ── Header background (rounded top, flat bottom via overlay strip) ───────
    svg += `<rect x="${x}" y="${y}" width="${w}" height="${HEADER_H}" rx="3"
                 style="fill:${hc.fill}" stroke="none"/>`;
    svg += `<rect x="${x}" y="${y + HEADER_H - 4}" width="${w}" height="4"
                 style="fill:${hc.fill}" stroke="none"/>`;

    // ── Stereotype label and class name ──────────────────────────────────────
    if (cls.type !== 'class') {
        // Non-class types show a «stereotype» label above the name.
        const stereo = cls.type === 'interface' ? '«interface»'
                     : cls.type === 'enum'      ? '«enumeration»'
                     :                            `«${cls.type}»`;
        svg += `<text x="${x + w / 2}" y="${y + 13}"
                      text-anchor="middle"
                      font-family="monospace" font-size="10"
                      fill="${hc.text}" fill-opacity="0.65">${escapeXml(stereo)}</text>`;
        svg += `<text x="${x + w / 2}" y="${y + 30}"
                      text-anchor="middle"
                      font-family="sans-serif" font-size="13" font-weight="500"
                      fill="${hc.text}">${escapeXml(cls.name)}</text>`;
    } else {
        // Plain class — name centred in header; italic for abstract classes.
        const fontStyle = cls.isAbstract ? 'italic' : 'normal';
        svg += `<text x="${x + w / 2}" y="${y + HEADER_H / 2 + 5}"
                      text-anchor="middle"
                      font-family="sans-serif" font-size="13" font-weight="500"
                      font-style="${fontStyle}"
                      fill="${hc.text}">${escapeXml(cls.name)}</text>`;
    }

    // ── Divider: header / fields ─────────────────────────────────────────────
    svg += `<line x1="${x}" y1="${y + HEADER_H}"
                  x2="${x + w}" y2="${y + HEADER_H}"
                  stroke="var(--text-primary)" stroke-opacity="0.15" stroke-width="0.5"/>`;

    // ── Field rows (colored per-part tspans; only visible fields shown) ──────
    const fields     = visibleFields(cls);
    const fieldBaseY = y + HEADER_H + V_PAD + LINE_H * 0.75;
    fields.forEach((field, i) => {
        svg += renderFieldText(field, x + H_PAD, fieldBaseY + i * LINE_H, w - H_PAD * 2);
    });

    // ── Divider: fields / methods ────────────────────────────────────────────
    const dividerY = y + HEADER_H + 1 + fh;
    svg += `<line x1="${x}" y1="${dividerY}"
                  x2="${x + w}" y2="${dividerY}"
                  stroke="var(--text-primary)" stroke-opacity="0.15" stroke-width="0.5"/>`;

    // ── Method rows (colored per-part tspans; only visible methods shown) ────
    const methods     = visibleMethods(cls);
    const methodBaseY = dividerY + V_PAD + LINE_H * 0.75;
    methods.forEach((method, i) => {
        svg += renderMethodText(method, x + H_PAD, methodBaseY + i * LINE_H, w - H_PAD * 2);
    });

    svg += `</g>`;
    return svg;
}


/**
 * Build SVG markup for the diagram title bracket overlay.
 *
 * Renders a dashed rectangle that encloses all class boxes with the title text
 * centred at the top. Only rendered when {@link diagramTitle} is non-empty and
 * at least one class is loaded.
 *
 * @returns {string} SVG markup string, or '' when no title is set
 */
function renderTitleBracket() {
    if (!diagramTitle || !Object.keys(classMap).length) return '';

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    Object.keys(classMap).forEach(n => {
        const p = positions[n], d = dims[n];
        if (!p || !d) return;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + d.w);
        maxY = Math.max(maxY, p.y + d.h);
    });

    const PAD     = 24;
    const TITLE_H = 28;
    const bx = minX - PAD;
    const by = minY - PAD - TITLE_H;
    const bw = (maxX - minX) + PAD * 2;
    const bh = (maxY - minY) + PAD * 2 + TITLE_H;

    let svg = '';
    // Outer dashed bracket
    svg += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="6"
                  fill="none"
                  stroke="var(--text-primary)" stroke-opacity="0.18"
                  stroke-width="1" stroke-dasharray="8 4"/>`;
    // Title text
    svg += `<text x="${bx + bw / 2}" y="${by + TITLE_H * 0.65}"
                  text-anchor="middle"
                  font-family="sans-serif" font-size="15" font-weight="500"
                  fill="var(--text-primary)" fill-opacity="0.65">${escapeXml(diagramTitle)}</text>`;
    // Separator line below title
    svg += `<line x1="${bx + 8}" y1="${by + TITLE_H}"
                  x2="${bx + bw - 8}" y2="${by + TITLE_H}"
                  stroke="var(--text-primary)" stroke-opacity="0.12" stroke-width="0.5"/>`;
    return svg;
}


/**
 * Build SVG markup for the draggable legend box rendered in world space.
 *
 * The legend is positioned in world coordinates so it participates in pan and
 * zoom exactly like class boxes. On the first call it auto-places itself to the
 * right of the class bounding box. The user can then drag it anywhere.
 *
 * Uses CSS custom properties directly (no pre-resolved colors) so it renders
 * consistently with the rest of the canvas and gets resolved correctly during
 * export by {@link buildExportSVG}.
 *
 * Returns '' when no relationships are present in the current diagram.
 *
 * @returns {string} SVG {@code <g>} element markup, or '' when nothing to show
 */
function renderLegendBox() {
    const present = computePresentRelationships();
    const ORDER   = ['inheritance', 'implementation', 'composition',
                     'aggregation', 'depUse', 'depCreates'];
    const types   = ORDER.filter(t => present.has(t));
    if (!types.length) return '';
 
    const LABELS = {
        inheritance:    'extends',
        implementation: 'implements',
        composition:    'composition',
        aggregation:    'aggregation',
        depUse:         '<<use>>',
        depCreates:     '<<creates>>',
    };
 
    const ROW_H   = 20;
    const ICON_W  = 56;
    const GAP     = 8;
    const PAD     = 10;
    const TITLE_H = 20;
    const MID     = ROW_H / 2;
    const boxW    = PAD + ICON_W + GAP + 82 + PAD;
    const boxH    = TITLE_H + PAD + types.length * ROW_H + PAD;
 
    // Auto-place to the right of the class bounding box on first appearance.
    if (!legendPos) {
        const bounds = computeWorldBounds();
        legendPos = bounds
            ? { x: bounds.maxX + 36, y: bounds.minY }
            : { x: 30, y: 30 };
    }
 
    const { x, y } = legendPos;
    const BG   = 'var(--bg-primary)';
    const BD   = 'var(--border-hover)';
    const TEXT = 'var(--text-secondary)';
 
    /**
     * Inline SVG icon for a single relationship type, using CSS variables.
     *
     * @param  {string} type - Relationship type identifier
     * @param  {number} iy   - Y baseline for this icon row in world coordinates
     * @returns {string}       SVG markup for the icon
     */
    function iconRow(type, iy) {
        const my = iy + MID;
        const ix = x + PAD;
        switch (type) {
            case 'inheritance':
                return `<line x1="${ix+2}" y1="${my}" x2="${ix+40}" y2="${my}"
                               stroke="var(--arrow-inherit)" stroke-width="1.5"/>
                         <path d="M${ix+40},${iy+2} L${ix+51},${my} L${ix+40},${iy+ROW_H-2} Z"
                               fill="${BG}" stroke="var(--arrow-inherit)" stroke-width="1.2"
                               stroke-linejoin="round"/>`;
            case 'implementation':
                return `<line x1="${ix+2}" y1="${my}" x2="${ix+40}" y2="${my}"
                               stroke="var(--arrow-impl)" stroke-width="1.2" stroke-dasharray="4 2"/>
                         <path d="M${ix+40},${iy+2} L${ix+51},${my} L${ix+40},${iy+ROW_H-2} Z"
                               fill="${BG}" stroke="var(--arrow-impl)" stroke-width="1.2"
                               stroke-linejoin="round"/>`;
            case 'composition':
                return `<polygon points="${ix+2},${my} ${ix+10},${iy+2} ${ix+18},${my} ${ix+10},${iy+ROW_H-2}"
                                 fill="var(--arrow-comp)" opacity="0.85"/>
                         <line x1="${ix+18}" y1="${my}" x2="${ix+54}" y2="${my}"
                               stroke="var(--arrow-comp)" stroke-width="1.4"/>`;
            case 'aggregation':
                return `<polygon points="${ix+2},${my} ${ix+10},${iy+2} ${ix+18},${my} ${ix+10},${iy+ROW_H-2}"
                                 fill="${BG}" stroke="var(--arrow-agg)" stroke-width="1.2"
                                 stroke-linejoin="round"/>
                         <line x1="${ix+18}" y1="${my}" x2="${ix+54}" y2="${my}"
                               stroke="var(--arrow-agg)" stroke-width="1.2"/>`;
            case 'depUse':
                return `<line x1="${ix+2}" y1="${my}" x2="${ix+42}" y2="${my}"
                               stroke="var(--arrow-dep-use)" stroke-width="1.1" stroke-dasharray="5 2"/>
                         <path d="M${ix+41},${iy+2} L${ix+51},${my} L${ix+41},${iy+ROW_H-2}"
                               fill="none" stroke="var(--arrow-dep-use)" stroke-width="1.3"
                               stroke-linecap="round" stroke-linejoin="round"/>`;
            case 'depCreates':
                return `<line x1="${ix+2}" y1="${my}" x2="${ix+42}" y2="${my}"
                               stroke="var(--arrow-dep-create)" stroke-width="1.1" stroke-dasharray="8 2"/>
                         <path d="M${ix+41},${iy+2} L${ix+51},${my} L${ix+41},${iy+ROW_H-2}"
                               fill="none" stroke="var(--arrow-dep-create)" stroke-width="1.3"
                               stroke-linecap="round" stroke-linejoin="round"/>`;
            default: return '';
        }
    }
 
    let g = `<g data-legend="true" class="uml-box">`;
 
    // Background + border
    g += `<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="5"
                fill="${BG}" stroke="${BD}" stroke-width="0.8" stroke-opacity="0.55"/>`;
 
    // Title bar
    g += `<rect x="${x}" y="${y}" width="${boxW}" height="${TITLE_H}" rx="5"
                fill="var(--bg-secondary)" stroke="none"/>`;
    g += `<rect x="${x}" y="${y + TITLE_H - 4}" width="${boxW}" height="4"
                fill="var(--bg-secondary)" stroke="none"/>`;
    g += `<text x="${x + PAD}" y="${y + TITLE_H * 0.72}"
                font-family="sans-serif" font-size="10" font-weight="600"
                fill="${TEXT}">Legend</text>`;
    g += `<line x1="${x + 4}" y1="${y + TITLE_H}"
                x2="${x + boxW - 4}" y2="${y + TITLE_H}"
                stroke="${BD}" stroke-width="0.5" stroke-opacity="0.5"/>`;
 
    // Relationship rows
    types.forEach((type, i) => {
        const iy = y + TITLE_H + PAD + i * ROW_H;
        g += iconRow(type, iy);
        g += `<text x="${x + PAD + ICON_W + GAP}" y="${iy + MID + 4}"
                    font-family="sans-serif" font-size="10"
                    fill="${TEXT}">${escapeXml(LABELS[type])}</text>`;
    });
 
    g += `</g>`;
    return g;
}


/**
 * Re-render the complete diagram into the SVG world group.
 *
 * Applies the current {@link viewTransform}, then writes (in order):
 * title bracket → relationship arrows → class boxes.
 * Shows the empty-state placeholder when no classes are loaded.
 *
 * @returns {void}
 */
function render() {
    const world      = document.getElementById('world');
    const emptyState = document.getElementById('empty-state');
    const names      = Object.keys(classMap);

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
    svg += renderSections();
    svg += renderTitleBracket();
    svg += renderArrows();
    names.forEach(n => { svg += renderBox(n); });
    svg += renderLegendBox();
    world.innerHTML = svg;
}


// ════════════════════════════════════════════════════════════════
//  EXPORT
// ════════════════════════════════════════════════════════════════

/**
 * Compute the world-coordinate bounding box that encloses all loaded class boxes.
 *
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number }|null}
 *   Bounding box object, or null if no classes are loaded
 */
function computeWorldBounds() {
    const names = Object.keys(classMap);
    if (!names.length) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    names.forEach(n => {
        const p = positions[n], d = dims[n];
        if (!p || !d) return;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + d.w);
        maxY = Math.max(maxY, p.y + d.h);
    });

    return { minX, minY, maxX, maxY };
}


/**
 * Build a standalone SVG legend group for use in exports.
 *
 * Unlike the sidebar legend (which uses CSS variables and HTML), this version
 * uses only resolved color values so it renders correctly in any SVG viewer
 * or PNG renderer. Each relationship type present in the current diagram gets
 * one row with an inline icon and a text label.
 *
 * The group is positioned at the supplied (x, y) origin in the export canvas.
 *
 * @param  {CSSStyleDeclaration} cs      - Computed styles from the document root
 * @param  {string}              bgColor - Resolved background color for the legend box fill
 * @returns {string}                       SVG {@code <g>} element, or '' if no relationships exist
 */
function buildExportLegend(cs, bgColor) {
    const present = computePresentRelationships();
    const ORDER = ['inheritance', 'implementation', 'composition', 'aggregation', 'depUse', 'depCreates'];
    const types = ORDER.filter(t => present.has(t));
    if (!types.length) return '';

    const LABELS = {
        inheritance:    'extends',
        implementation: 'implements',
        composition:    'composition',
        aggregation:    'aggregation',
        depUse:         '<<use>>',
        depCreates:     '<<creates>>',
    };

    // Resolve the colors we need once.
    const r = prop => cs.getPropertyValue(prop).trim();
    const C = {
        inherit:  r('--arrow-inherit')    || '#2a2a28',
        impl:     r('--arrow-impl')       || '#636360',
        comp:     r('--arrow-comp')       || '#8b0000',
        agg:      r('--arrow-agg')        || '#b85c00',
        depU:     r('--arrow-dep-use')    || '#1450a0',
        depC:     r('--arrow-dep-create') || '#1a7a1a',
        text:     r('--text-secondary')   || '#6b6b67',
        border:   r('--border-hover')     || 'rgba(0,0,0,0.28)',
    };

    const ROW_H  = 18;   // px per legend row
    const ICON_W = 56;   // px width of the icon area
    const GAP    = 6;    // px gap between icon and label
    const PAD    = 10;   // px padding inside the legend box
    const MID    = ROW_H / 2;

    /**
     * Build the SVG icon for a single relationship type using only resolved colors.
     *
     * @param  {string} type - Relationship type identifier
     * @param  {number} y    - Vertical offset within the legend group
     * @returns {string}       SVG elements for the icon row
     */
    function icon(type, y) {
        const my = y + MID;
        switch (type) {
            case 'inheritance':
                return `<line x1="${PAD+2}" y1="${my}" x2="${PAD+40}" y2="${my}"
                               stroke="${C.inherit}" stroke-width="1.5"/>
                         <path d="M${PAD+40},${y+2} L${PAD+51},${my} L${PAD+40},${y+ROW_H-2} Z"
                               fill="${bgColor}" stroke="${C.inherit}" stroke-width="1.2"
                               stroke-linejoin="round"/>`;
            case 'implementation':
                return `<line x1="${PAD+2}" y1="${my}" x2="${PAD+40}" y2="${my}"
                               stroke="${C.impl}" stroke-width="1.2" stroke-dasharray="4 2"/>
                         <path d="M${PAD+40},${y+2} L${PAD+51},${my} L${PAD+40},${y+ROW_H-2} Z"
                               fill="${bgColor}" stroke="${C.impl}" stroke-width="1.2"
                               stroke-linejoin="round"/>`;
            case 'composition':
                return `<polygon points="${PAD+2},${my} ${PAD+10},${y+2} ${PAD+18},${my} ${PAD+10},${y+ROW_H-2}"
                                 fill="${C.comp}" opacity="0.85"/>
                         <line x1="${PAD+18}" y1="${my}" x2="${PAD+54}" y2="${my}"
                               stroke="${C.comp}" stroke-width="1.4"/>`;
            case 'aggregation':
                return `<polygon points="${PAD+2},${my} ${PAD+10},${y+2} ${PAD+18},${my} ${PAD+10},${y+ROW_H-2}"
                                 fill="${bgColor}" stroke="${C.agg}" stroke-width="1.2"
                                 stroke-linejoin="round"/>
                         <line x1="${PAD+18}" y1="${my}" x2="${PAD+54}" y2="${my}"
                               stroke="${C.agg}" stroke-width="1.2"/>`;
            case 'depUse':
                return `<line x1="${PAD+2}" y1="${my}" x2="${PAD+42}" y2="${my}"
                               stroke="${C.depU}" stroke-width="1.1" stroke-dasharray="5 2"/>
                         <path d="M${PAD+41},${y+2} L${PAD+51},${my} L${PAD+41},${y+ROW_H-2}"
                               fill="none" stroke="${C.depU}" stroke-width="1.3"
                               stroke-linecap="round" stroke-linejoin="round"/>`;
            case 'depCreates':
                return `<line x1="${PAD+2}" y1="${my}" x2="${PAD+42}" y2="${my}"
                               stroke="${C.depC}" stroke-width="1.1" stroke-dasharray="8 2"/>
                         <path d="M${PAD+41},${y+2} L${PAD+51},${my} L${PAD+41},${y+ROW_H-2}"
                               fill="none" stroke="${C.depC}" stroke-width="1.3"
                               stroke-linecap="round" stroke-linejoin="round"/>`;
            default: return '';
        }
    }

    const boxW = PAD + ICON_W + GAP + 68 + PAD;   // icon + gap + max label width + padding
    const boxH = PAD + types.length * ROW_H + PAD;

    let g = `<g id="export-legend">`;
    // Background box
    g += `<rect width="${boxW}" height="${boxH}" rx="5"
                fill="${bgColor}" fill-opacity="0.92"
                stroke="${C.border}" stroke-width="0.8"/>`;

    types.forEach((type, i) => {
        const y = PAD + i * ROW_H;
        g += icon(type, y);
        g += `<text x="${PAD + ICON_W + GAP}" y="${y + MID + 4}"
                    font-family="sans-serif" font-size="10"
                    fill="${C.text}">${escapeXml(LABELS[type])}</text>`;
    });

    g += `</g>`;
    return g;
}


/**
 * Build a standalone, self-contained SVG string of the current diagram.
 *
 * CSS variables are resolved to their current computed values so the exported
 * file renders correctly in any SVG viewer without access to styles.css.
 * The title bracket is always included when {@link diagramTitle} is set,
 * regardless of the current viewport position. The legend is placed in the
 * bottom-left corner of the export canvas.
 *
 * @returns {string|null} Complete SVG document string, or null if nothing is loaded
 */
function buildExportSVG() {
    const bounds = computeWorldBounds();
    if (!bounds) return null;
 
    const { minX, minY, maxX, maxY } = bounds;
    const PAD     = 40;
    const TITLE_H = diagramTitle ? 50 : 0;
    const viewW   = (maxX - minX) + PAD * 2;
    const viewH   = (maxY - minY) + PAD * 2 + TITLE_H;
 
    // Re-render all content at identity transform (no pan/zoom offset).
    const savedVT = { ...viewTransform };
    viewTransform = { tx: PAD + TITLE_H - minX, ty: PAD + TITLE_H - minY, sc: 1 };
 
    let content = renderSections() + renderTitleBracket() + renderArrows();
    Object.keys(classMap).forEach(n => { content += renderBox(n); });
 
    viewTransform = savedVT;
 
    // Strip bend-handle circles — interactive UI only, not diagram content.
    content = content.replace(/<circle class="bend-handle"[\s\S]*?\/>/g, '');
 
    // Dynamically resolve every CSS custom property referenced in the rendered content.
    // This is more robust than a manual list — it catches all variables including
    // --uml-field-name, --uml-ctor-name, --arrow-impl, --text-primary, etc.
    const cs = getComputedStyle(document.documentElement);
    content = content.replace(/var\(--[\w-]+\)/g, match => {
        const propName = match.slice(4, -1);     // strip 'var(' and ')'
        const resolved = cs.getPropertyValue(propName).trim();
        return resolved || match;
    });
 
    // Resolve the background color for the SVG background rect.
    const bgColor = cs.getPropertyValue('--bg-primary').trim() || '#ffffff';
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" `;
    svg += `width="${viewW}" height="${viewH}" `;
    svg += `viewBox="0 0 ${viewW} ${viewH}">\n`;
 
    // Background
    svg += `  <rect width="${viewW}" height="${viewH}" fill="${bgColor}"/>\n`;
 
    // Arrow marker defs (using resolved colors)
    const arrowColor = cs.getPropertyValue('--arrow-inherit').trim() || '#2a2a28';
    const compColor  = cs.getPropertyValue('--arrow-comp').trim()    || '#8b0000';
    const aggColor   = cs.getPropertyValue('--arrow-agg').trim()     || '#b85c00';
    const depUColor  = cs.getPropertyValue('--arrow-dep-use').trim() || '#1450a0';
    const depCColor  = cs.getPropertyValue('--arrow-dep-create').trim() || '#1a7a1a';
    svg += `  <defs>\n`;
    svg += `    <marker id="ei" viewBox="0 0 12 12" refX="11.5" refY="6" markerWidth="10" markerHeight="10" orient="auto">
      <path d="M1 1L11 6L1 11Z" fill="${bgColor}" stroke="${arrowColor}" stroke-width="1.2"/></marker>\n`;
    svg += `    <marker id="ec" viewBox="0 0 22 12" refX="21" refY="6" markerWidth="16" markerHeight="12" orient="auto-start-reverse">
      <path d="M1 6 L10 1 L19 6 L10 11 Z" fill="${compColor}"/></marker>\n`;
    svg += `    <marker id="ea" viewBox="0 0 22 12" refX="21" refY="6" markerWidth="16" markerHeight="12" orient="auto-start-reverse">
      <path d="M1 6 L10 1 L19 6 L10 11 Z" fill="${bgColor}" stroke="${aggColor}" stroke-width="1.2"/></marker>\n`;
    svg += `    <marker id="ed" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M1 1.5L8 5L1 8.5" fill="none" stroke="${depUColor}" stroke-width="1.5" stroke-linecap="round"/></marker>\n`;
    svg += `    <marker id="edc" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M1 1.5L8 5L1 8.5" fill="none" stroke="${depCColor}" stroke-width="1.5" stroke-linecap="round"/></marker>\n`;
    svg += `  </defs>\n`;

    // Replace live marker IDs with export-specific IDs.
    // depCreates gets its own marker (edc) so it renders in green, not blue.
    content = content
        .replaceAll('url(#m-inh)',  'url(#ei)')
        .replaceAll('url(#m-impl)', 'url(#ei)')
        .replaceAll('url(#m-comp)', 'url(#ec)')
        .replaceAll('url(#m-agg)',  'url(#ea)')
        .replace(/stroke-dasharray="9 3"[^/]*marker-end="url\(#m-dep\)"/g,
                 m => m.replace('url(#m-dep)', 'url(#edc)'))
        .replaceAll('url(#m-dep)',  'url(#ed)');

    svg += `  <g transform="translate(${PAD - minX},${PAD + TITLE_H - minY})">\n`;
    svg += content + '\n';
    svg += `  </g>\n`;
    svg += `</svg>`;

    return svg;
}


/**
 * Export the current diagram as a downloadable SVG file.
 *
 * The filename is derived from {@link diagramTitle} when set,
 * or falls back to 'uml-diagram'.
 *
 * @returns {void}
 */
function exportSVG() {
    const svgStr = buildExportSVG();
    if (!svgStr) return;

    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = (diagramTitle || 'uml-diagram') + '.svg';
    a.click();
    URL.revokeObjectURL(url);
}


/**
 * Export the current diagram as a downloadable PNG file at 2× resolution.
 *
 * Builds an SVG, renders it to an off-screen canvas via an Image element,
 * and saves the canvas as a PNG.
 *
 * @returns {void}
 */
function exportPNG() {
    const svgStr = buildExportSVG();
    if (!svgStr) return;

    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);

    const img = new Image();
    img.onload = () => {
        const scale   = 2;
        const canvas  = document.createElement('canvas');
        canvas.width  = img.naturalWidth  * scale;
        canvas.height = img.naturalHeight * scale;

        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);

        const pngUrl = canvas.toDataURL('image/png');
        const a      = document.createElement('a');
        a.href       = pngUrl;
        a.download   = (diagramTitle || 'uml-diagram') + '.png';
        a.click();
    };
    img.onerror = (e) => {
        console.error('PNG export failed — SVG could not be rendered to canvas.', e);
        console.debug('SVG preview (first 2000 chars):', svgStr.slice(0, 2000));
    };
    img.src = dataUrl;
}


// ════════════════════════════════════════════════════════════════
//  FILE HANDLING
// ════════════════════════════════════════════════════════════════

/**
 * Read an array of {@link File} objects, parse any valid .java files,
 * register them in {@link classMap}, and refresh the diagram and sidebar.
 *
 * Non-.java files are silently skipped. Unparseable files are warned to console.
 *
 * @param  {File[]} files - Files from a file-input change or drag-and-drop event
 * @returns {void}
 */
function handleFiles(files) {
    files.forEach(file => {
        if (!file.name.endsWith('.java')) return;

        const reader = new FileReader();
        reader.onload = e => {
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
 * Each entry is a clickable row with an inline remove button.
 * The selected class receives the CSS class 'selected'.
 *
 * @returns {void}
 */
function updateFileList() {
    const list = document.getElementById('file-list');
 
    // Build the section <option> list once, reused for every class row.
    const sectionOptions = sections.map(s =>
        `<option value="${escapeXml(s.id)}">${escapeXml(s.name)}</option>`
    ).join('');
 
    list.innerHTML = Object.values(classMap).map(cls => {
        const assigned = sectionAssignments[cls.name] || '';
        return `
        <div class="file-item${selectedClass === cls.name ? ' selected' : ''}"
             onclick="selectClass('${escapeXml(cls.name)}')">
            <span class="file-name" title="${escapeXml(cls.name)}.java">${escapeXml(cls.name)}</span>
            <select class="section-select"
                    title="Assign to section"
                    onclick="event.stopPropagation()"
                    onchange="event.stopPropagation(); assignClassToSection('${escapeXml(cls.name)}', this.value)">
                <option value="">—</option>
                ${sectionOptions}
            </select>
            <button class="remove-btn"
                    onclick="event.stopPropagation(); removeClass('${escapeXml(cls.name)}')"
                    title="Remove">×</button>
        </div>`;
    }).join('');
 
    // Restore the selected value for each dropdown (innerHTML reset clears them).
    Object.values(classMap).forEach(cls => {
        const assigned = sectionAssignments[cls.name] || '';
        const row  = list.querySelector(`[onclick*="${escapeXml(cls.name)}"]`);
        if (!row) return;
        const sel = row.querySelector('.section-select');
        if (sel) sel.value = assigned;
    });
}


/**
 * Show or hide the legend, relationship toggles, and export buttons based on
 * whether any classes are currently loaded. Also rebuilds the legend content
 * via {@link updateLegend} so it always reflects the current diagram state.
 *
 * @returns {void}
 */
function updateBottomPanel() {
    const hasClasses = Object.keys(classMap).length > 0;
    const display    = hasClasses ? 'flex' : 'none';
    document.getElementById('bottom').style.display          = display;
    document.getElementById('member-section').style.display = display;
    document.getElementById('rel-section').style.display    = display;
    document.getElementById('export-section').style.display = display;
    updateLegend();
}


/**
 * Toggle the selection state of a class box.
 *
 * Selecting an already-selected class deselects it.
 *
 * @param  {string} name - Class name to select or deselect
 * @returns {void}
 */
function selectClass(name) {
    selectedClass = (selectedClass === name) ? null : name;
    render();
    updateFileList();
}


/**
 * Remove a class from the diagram completely and refresh the UI.
 *
 * @param  {string} name - Class name to remove
 * @returns {void}
 */
function removeClass(name) {
    delete classMap[name];
    delete positions[name];
    delete dims[name];
    delete sectionAssignments[name];
    if (selectedClass === name) selectedClass = null;

    // Remove any stored bend offsets that involve this class.
    Object.keys(bendOffsets).forEach(k => {
        if (k.startsWith(name + '::') || k.includes('::' + name + '::')) {
            delete bendOffsets[k];
            delete bendEdgeCache[k];
        }
    });
    autoLayout();
    render();
    updateFileList();
    updateBottomPanel();
}


/**
 * Remove all loaded classes and reset the viewport to its initial state.
 *
 * @returns {void}
 */
function clearAll() {
    classMap            = {};
    positions           = {};
    dims                = {};
    sections            = [];
    sectionAssignments  = {};
    legendPos           = null;
    selectedClass       = null;
    viewTransform       = { tx: 30, ty: 30, sc: 1 };
    Object.keys(bendOffsets).forEach(k => { delete bendOffsets[k]; });
    Object.keys(bendEdgeCache).forEach(k => { delete bendEdgeCache[k]; });
    updateSectionList();
    render();
    updateFileList();
    updateBottomPanel();
}


// ════════════════════════════════════════════════════════════════
//  THEME & TITLE
// ════════════════════════════════════════════════════════════════

/**
 * Apply a color theme by setting the {@code data-theme} attribute on
 * {@code <html>}. Pass {@code 'default'} to remove the attribute and
 * fall back to the OS light/dark preference.
 *
 * @param  {string} name - Theme identifier: 'default' | 'blueprint' | 'sepia' | 'mono'
 * @returns {void}
 */
function setTheme(name) {
    currentTheme = name;
    if (name === 'default') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', name);
    }
    render();
}


/**
 * Update the diagram title and re-render the title bracket.
 *
 * Called by the title input's {@code oninput} handler.
 *
 * @param  {string} value - New title text (may be empty to remove the bracket)
 * @returns {void}
 */
function updateTitle(value) {
    diagramTitle = value.trim();
    render();
}


/**
 * Toggle the visibility of a member category (fields, methods, or constructors)
 * and re-render. Recalculates box dimensions via {@link refreshDims} so that
 * hiding a category shrinks the box height immediately.
 *
 * Called by the member-section checkbox {@code onchange} handlers.
 *
 * @param  {string}  key     - Key in {@link visMembers}: 'fields' | 'methods' | 'constructors'
 * @param  {boolean} visible - Whether members of this category should be shown
 * @returns {void}
 */
function toggleMember(key, visible) {
    visMembers[key] = visible;
    refreshDims();
    render();
}


/**
 * @param  {string}  key     - Key in {@link visRelationships}: 'composition' | 'aggregation' | 'depUse' | 'depCreates'
 * @param  {boolean} visible - Whether arrows of this type should be shown
 * @returns {void}
 */
function toggleRel(key, visible) {
    visRelationships[key] = visible;
    render();
}


// ════════════════════════════════════════════════════════════════
//  INTERACTIONS — Pan, Zoom, Drag
// ════════════════════════════════════════════════════════════════

/**
 * Convert a screen (client) coordinate to the SVG world coordinate space,
 * accounting for the current pan offset and zoom scale.
 *
 * @param  {number}   clientX - X position in screen pixels
 * @param  {number}   clientY - Y position in screen pixels
 * @returns {Position}          Equivalent position in world coordinates
 */
function clientToWorld(clientX, clientY) {
    const rect = document.getElementById('diagram').getBoundingClientRect();
    return {
        x: (clientX - rect.left - viewTransform.tx) / viewTransform.sc,
        y: (clientY - rect.top  - viewTransform.ty) / viewTransform.sc,
    };
}


// ── Mousedown: begin a box drag or a canvas pan ──────────────────────────────

document.getElementById('diagram').addEventListener('mousedown', e => {
    // ── Legend box drag ──────────────────────────────────────────
    const legendEl = e.target.closest('[data-legend]');
    if (legendEl) {
        const wm = clientToWorld(e.clientX, e.clientY);
        dragState = {
            type:    'legend',
            startMX: wm.x,   startMY: wm.y,
            startLX: legendPos.x, startLY: legendPos.y,
        };
        document.getElementById('diagram').classList.add('dragging-box');
        e.preventDefault();
        return;
    }

    // ── Bend handle drag ─────────────────────────────────────────
    const handleEl = e.target.closest('.bend-handle');
    if (handleEl) {
        const bendKey  = handleEl.getAttribute('data-bend-key');
        const axis     = handleEl.getAttribute('data-bend-axis');
        const wm       = clientToWorld(e.clientX, e.clientY);
        dragState = {
            type:        'bend',
            bendKey,
            axis,
            startWorld:  axis === 'vertical' ? wm.y : wm.x,
            startOffset: bendOffsets[bendKey] || 0,
        };
        document.getElementById('diagram').classList.add(
            axis === 'vertical' ? 'dragging-bend-v' : 'dragging-bend-h'
        );
    e.preventDefault();
    return;
}

    const boxEl = e.target.closest('[data-class]');

    if (boxEl) {
        // Clicked on a class box — start a box drag.
        const name = boxEl.getAttribute('data-class');
        const wm   = clientToWorld(e.clientX, e.clientY);
        const pos  = positions[name];
        selectClass(name);
        dragState = {
            type:    'box',
            name,
            startMX: wm.x,  startMY: wm.y,
            startBX: pos.x,  startBY: pos.y
        };
        document.getElementById('diagram').classList.add('dragging-box');
    } else {
        // Clicked on empty canvas — deselect and start a pan.
        if (selectedClass) { selectedClass = null; render(); updateFileList(); }
        dragState = {
            type:    'pan',
            startMX: e.clientX,        startMY: e.clientY,
            startTX: viewTransform.tx,  startTY: viewTransform.ty
        };
    }

    e.preventDefault();
});


// ── Mousemove: apply the active drag or pan ──────────────────────────────────

window.addEventListener('mousemove', e => {
    if (!dragState) return;

    if (dragState.type === 'pan') {
        viewTransform.tx = dragState.startTX + (e.clientX - dragState.startMX);
        viewTransform.ty = dragState.startTY + (e.clientY - dragState.startMY);
    } else if (dragState.type === 'bend') {
        const wm    = clientToWorld(e.clientX, e.clientY);
        const delta = dragState.axis === 'vertical'
            ? wm.y - dragState.startWorld
            : wm.x - dragState.startWorld;
        bendOffsets[dragState.bendKey] = dragState.startOffset + delta;
    } else if (dragState.type === 'legend') {
        const wm = clientToWorld(e.clientX, e.clientY);
        legendPos = {
            x: dragState.startLX + (wm.x - dragState.startMX),
            y: dragState.startLY + (wm.y - dragState.startMY),
        };
    } else if (dragState.type === 'box') {
        const wm = clientToWorld(e.clientX, e.clientY);
        positions[dragState.name] = {
            x: dragState.startBX + (wm.x - dragState.startMX),
            y: dragState.startBY + (wm.y - dragState.startMY),
        };
    }

    render();
});


// ── Mouseup: end the current drag ────────────────────────────────────────────

window.addEventListener('mouseup', () => {
    if (dragState && dragState.type === 'bend') {
        document.exitPointerLock();
    }
    dragState = null;
    const diag = document.getElementById('diagram');
    diag.classList.remove('dragging-box', 'dragging-bend-v', 'dragging-bend-h');
});


// ── Wheel: zoom centred on the cursor position ───────────────────────────────

document.getElementById('diagram').addEventListener('wheel', e => {
    e.preventDefault();

    const factor   = e.deltaY > 0 ? 0.9 : 1.1;
    const rect     = document.getElementById('diagram').getBoundingClientRect();
    const mx       = e.clientX - rect.left;
    const my       = e.clientY - rect.top;
    const newScale = Math.max(0.15, Math.min(4, viewTransform.sc * factor));

    // Adjust translation so the point under the cursor stays fixed.
    viewTransform.tx = mx - (mx - viewTransform.tx) * (newScale / viewTransform.sc);
    viewTransform.ty = my - (my - viewTransform.ty) * (newScale / viewTransform.sc);
    viewTransform.sc = newScale;

    render();
}, { passive: false });


// ════════════════════════════════════════════════════════════════
//  TOOLBAR ACTIONS
// ════════════════════════════════════════════════════════════════

/**
 * Zoom the diagram in or out, centred on the middle of the canvas.
 *
 * The scale is clamped to [0.15, 4.0].
 *
 * @param  {number} factor - Scale multiplier (e.g. 1.2 zooms in, 0.83 zooms out)
 * @returns {void}
 */
function zoom(factor) {
    const rect = document.getElementById('diagram').getBoundingClientRect();
    const mx   = rect.width  / 2;
    const my   = rect.height / 2;
    const ns   = Math.max(0.15, Math.min(4, viewTransform.sc * factor));

    viewTransform.tx = mx - (mx - viewTransform.tx) * (ns / viewTransform.sc);
    viewTransform.ty = my - (my - viewTransform.ty) * (ns / viewTransform.sc);
    viewTransform.sc = ns;
    render();
}


/**
 * Scale and translate the view so all class boxes fit in the canvas with
 * a 30 px margin. Scale is capped at 1.5. Has no effect when no classes are loaded.
 *
 * @returns {void}
 */
function fitView() {
    const bounds = computeWorldBounds();
    if (!bounds) return;

    const { minX, minY, maxX, maxY } = bounds;
    const rect = document.getElementById('diagram').getBoundingClientRect();
    const W    = rect.width  - 60;
    const H    = rect.height - 60;
    const ns   = Math.min(W / (maxX - minX), H / (maxY - minY), 1.5);

    viewTransform.sc = ns;
    viewTransform.tx = 30 - minX * ns;
    viewTransform.ty = 30 - minY * ns;
    render();
}


// ════════════════════════════════════════════════════════════════
//  DRAG-AND-DROP & FILE INPUT
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
 * Non-.java files are silently ignored by {@link handleFiles}.
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
 * The input value is reset so the same file can be re-uploaded after removal.
 *
 * @listens change
 */
document.getElementById('file-input').addEventListener('change', function (e) {
    handleFiles(Array.from(e.target.files));
    this.value = '';
});


// ════════════════════════════════════════════════════════════════
//  INITIALISATION
// ════════════════════════════════════════════════════════════════

// Perform an initial render to display the empty-state placeholder on page load.
render();
