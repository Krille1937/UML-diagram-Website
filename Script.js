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
 * @version 0.2.0
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
 * Compute the start/end points and optional elbow segment for a relationship arrow.
 *
 * Selects the box edge pair (top/bottom or left/right) that minimises arrow length.
 * Mostly-vertical arrows include a horizontal elbow at the Y midpoint.
 *
 * The slot parameters spread multiple arrows that share the same edge so they
 * never overlap. Each arrow is assigned a fraction along the edge:
 * fraction = (slotIndex + 1) / (totalSlots + 1), so arrows distribute evenly
 * between the edges corners with a margin on each side.
 *
 * @param  {Position}      fromPos       - Top-left position of the source box
 * @param  {BoxDimensions} fromDim       - Dimensions of the source box
 * @param  {Position}      toPos         - Top-left position of the target box
 * @param  {BoxDimensions} toDim         - Dimensions of the target box
 * @param  {number}        fromSlotIdx   - Index of this arrow among all arrows leaving the same source edge
 * @param  {number}        fromSlotTotal - Total arrows leaving that source edge
 * @param  {number}        toSlotIdx     - Index of this arrow among all arrows arriving at the same target edge
 * @param  {number}        toSlotTotal   - Total arrows arriving at that target edge
 * @returns {ConnectionPoints}             Computed arrow geometry
 */
function connectionPoints(fromPos, fromDim, toPos, toDim,
                          fromSlotIdx = 0, fromSlotTotal = 1,
                          toSlotIdx   = 0, toSlotTotal   = 1) {
    const fCX = fromPos.x + fromDim.w / 2;
    const fCY = fromPos.y + fromDim.h / 2;
    const tCX = toPos.x   + toDim.w  / 2;
    const tCY = toPos.y   + toDim.h  / 2;
    const dx  = tCX - fCX;
    const dy  = tCY - fCY;

    // Evenly spaced fractions along each edge; single arrows default to 0.5 (centre).
    const fromFrac = (fromSlotIdx + 1) / (fromSlotTotal + 1);
    const toFrac   = (toSlotIdx   + 1) / (toSlotTotal   + 1);

    let sx, sy, ex, ey;

    if (Math.abs(dy) >= Math.abs(dx)) {
        // Mostly vertical — spread contact points horizontally along top/bottom edges.
        if (dy < 0) {
            sx = fromPos.x + fromDim.w * fromFrac; sy = fromPos.y;             // source: top edge
            ex = toPos.x   + toDim.w  * toFrac;    ey = toPos.y + toDim.h;   // target: bottom edge
        } else {
            sx = fromPos.x + fromDim.w * fromFrac; sy = fromPos.y + fromDim.h; // source: bottom edge
            ex = toPos.x   + toDim.w  * toFrac;    ey = toPos.y;               // target: top edge
        }
    } else {
        // Mostly horizontal — spread contact points vertically along left/right edges.
        if (dx < 0) {
            sx = fromPos.x;             sy = fromPos.y + fromDim.h * fromFrac; // source: left edge
            ex = toPos.x + toDim.w;    ey = toPos.y   + toDim.h  * toFrac;   // target: right edge
        } else {
            sx = fromPos.x + fromDim.w; sy = fromPos.y + fromDim.h * fromFrac; // source: right edge
            ex = toPos.x;               ey = toPos.y   + toDim.h  * toFrac;   // target: left edge
        }
    }

    // Add a horizontal elbow for vertical arrows to prevent diagonal lines.
    const midY      = (sy + ey) / 2;
    const elbowPath = Math.abs(dy) >= Math.abs(dx)
        ? `L${sx},${midY} L${ex},${midY}`
        : '';

    return { sx, sy, ex, ey, elbowPath };
}


/**
 * Build SVG markup for a text label centred on a relationship arrow.
 *
 * Uses ASCII angle-bracket notation (e.g. {@code <<use>>}) rather than
 * guillemet characters (« ») because guillemets may not render in all
 * monospace font stacks and can appear as '/' or replacement characters.
 * The label uses sans-serif to maximise glyph coverage.
 *
 * @param  {ConnectionPoints} c     - Arrow geometry
 * @param  {string}           label - ASCII label text, e.g. '<<use>>' or '<<creates>>'
 * @param  {string}           color - CSS color value for the text
 * @returns {string}                  SVG markup string for the label
 */
function renderArrowLabel(c, label, color) {
    const mx = (c.sx + c.ex) / 2;
    const my = (c.sy + c.ey) / 2 - 5;
    return `<text x="${mx}" y="${my}"
                  text-anchor="middle"
                  font-family="sans-serif" font-size="9"
                  fill="${color}" fill-opacity="0.90">${escapeXml(label)}</text>`;
}


/**
 * Build the SVG markup string for all relationship arrows.
 *
 * Uses a two-phase approach to prevent arrows from converging on the same point:
 *
 * Phase 1 (pre-pass): Every planned connection is collected, its source and
 * target edge determined, then grouped by class+edge. Each connection is assigned
 * a slotIndex within its group so that {@link connectionPoints} can spread the
 * contact points evenly along the edge rather than stacking them at the centre.
 *
 * Phase 2 (draw): Connections are drawn in visual priority order — weaker
 * relationship types first so stronger ones render on top. Within each type,
 * the draw order matches the pre-pass order so slot indices are consistent.
 *
 * @returns {string} Concatenated SVG {@code <path>} elements as an HTML string fragment
 */
function renderArrows() {

    // ── Phase 1: collect all planned connections ─────────────────────────────

    /** @type {Array<{fromName:string, toName:string, relType:string, fromEdge:string, toEdge:string, fromSlotIdx:number, fromSlotTotal:number, toSlotIdx:number, toSlotTotal:number}>} */
    const connections = [];

    Object.keys(classMap).forEach(fromName => {
        const cls     = classMap[fromName];
        const fromPos = positions[fromName];
        const fromDim = dims[fromName];
        if (!fromPos || !fromDim) return;

        // Detected structural / dependency relationships (weakest, drawn first)
        detectRelationships(fromName).forEach(rel => {
            if (!visRelationships[rel.type]) return;
            if (!classMap[rel.target] || !positions[rel.target]) return;
            connections.push({ fromName, toName: rel.target, relType: rel.type });
        });

        // Implementation (dashed inheritance — medium strength)
        cls.interfaces.forEach(ifc => {
            if (!classMap[ifc] || !positions[ifc]) return;
            connections.push({ fromName, toName: ifc, relType: 'implementation' });
        });

        // Inheritance (solid — strongest, drawn last / on top)
        if (cls.extendsClass && classMap[cls.extendsClass] && positions[cls.extendsClass]) {
            connections.push({ fromName, toName: cls.extendsClass, relType: 'inheritance' });
        }
    });

    // ── Determine which edge each connection uses at both ends ───────────────
    // Guard: skip any connection where positions or dims are not yet cached.
    // This prevents TypeError when boxes are mid-drag and dims are momentarily stale.

    const validConnections = connections.filter(conn => {
        return positions[conn.fromName] && dims[conn.fromName]
            && positions[conn.toName]   && dims[conn.toName];
    });

    validConnections.forEach(conn => {
        const fp = positions[conn.fromName], fd = dims[conn.fromName];
        const tp = positions[conn.toName],   td = dims[conn.toName];
        const dx = (tp.x + td.w / 2) - (fp.x + fd.w / 2);
        const dy = (tp.y + td.h / 2) - (fp.y + fd.h / 2);

        if (Math.abs(dy) >= Math.abs(dx)) {
            conn.fromEdge = dy < 0 ? 'top'    : 'bottom';
            conn.toEdge   = dy < 0 ? 'bottom' : 'top';
        } else {
            conn.fromEdge = dx < 0 ? 'left'   : 'right';
            conn.toEdge   = dx < 0 ? 'right'  : 'left';
        }
    });

    // ── Group by class+edge → assign slot indices ────────────────────────────

    /** @type {Object.<string, number[]>} Maps "className-edge" to an array of connection indices. */
    const toGroups   = {};
    const fromGroups = {};

    validConnections.forEach((conn, idx) => {
        const tk = `${conn.toName}-${conn.toEdge}`;
        const fk = `${conn.fromName}-${conn.fromEdge}`;
        (toGroups[tk]   = toGroups[tk]   || []).push(idx);
        (fromGroups[fk] = fromGroups[fk] || []).push(idx);
    });

    validConnections.forEach((conn, idx) => {
        const tk = `${conn.toName}-${conn.toEdge}`;
        const fk = `${conn.fromName}-${conn.fromEdge}`;
        conn.toSlotIdx     = toGroups[tk].indexOf(idx);
        conn.toSlotTotal   = toGroups[tk].length;
        conn.fromSlotIdx   = fromGroups[fk].indexOf(idx);
        conn.fromSlotTotal = fromGroups[fk].length;
    });

    // ── Phase 2: draw connections in order ───────────────────────────────────

    let svg = '';

    validConnections.forEach(conn => {
        const c = connectionPoints(
            positions[conn.fromName], dims[conn.fromName],
            positions[conn.toName],   dims[conn.toName],
            conn.fromSlotIdx, conn.fromSlotTotal,
            conn.toSlotIdx,   conn.toSlotTotal
        );

        switch (conn.relType) {

            case 'composition':
                // Filled diamond at owner (source) end, no arrowhead at part end.
                svg += `<path d="M${c.sx},${c.sy} ${c.elbowPath} L${c.ex},${c.ey}"
                              fill="none" stroke="var(--arrow-comp)" stroke-width="1.4"
                              marker-start="url(#m-comp)"/>`;
                break;

            case 'aggregation':
                // Hollow diamond at owner (source) end.
                svg += `<path d="M${c.sx},${c.sy} ${c.elbowPath} L${c.ex},${c.ey}"
                              fill="none" stroke="var(--arrow-agg)" stroke-width="1.2"
                              marker-start="url(#m-agg)"/>`;
                break;

            case 'depUse':
                // Dashed blue line, open arrowhead at target, <<use>> label.
                svg += `<path d="M${c.sx},${c.sy} ${c.elbowPath} L${c.ex},${c.ey}"
                              fill="none" stroke="var(--arrow-dep-use)" stroke-width="1.1"
                              stroke-dasharray="6 3" marker-end="url(#m-dep)"/>`;
                svg += renderArrowLabel(c, '<<use>>', 'var(--arrow-dep-use)');
                break;

            case 'depCreates':
                // Dashed green line (longer dash), open arrowhead, <<creates>> label.
                svg += `<path d="M${c.sx},${c.sy} ${c.elbowPath} L${c.ex},${c.ey}"
                              fill="none" stroke="var(--arrow-dep-create)" stroke-width="1.1"
                              stroke-dasharray="9 3" marker-end="url(#m-dep)"/>`;
                svg += renderArrowLabel(c, '<<creates>>', 'var(--arrow-dep-create)');
                break;

            case 'implementation':
                // Dashed line + hollow triangle arrowhead at interface end.
                svg += `<path d="M${c.sx},${c.sy} ${c.elbowPath} L${c.ex},${c.ey}"
                              fill="none" stroke="var(--arrow-impl)" stroke-width="1.2"
                              stroke-dasharray="6 3" marker-end="url(#m-impl)"/>`;
                break;

            case 'inheritance':
                // Solid line + hollow triangle arrowhead at superclass end.
                svg += `<path d="M${c.sx},${c.sy} ${c.elbowPath} L${c.ex},${c.ey}"
                              fill="none" stroke="var(--arrow-inherit)" stroke-width="1.5"
                              marker-end="url(#m-inh)"/>`;
                break;
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

    let svg = `<g data-class="${escapeXml(name)}" style="cursor:move">`;

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
    svg += renderTitleBracket();
    svg += renderArrows();
    names.forEach(n => { svg += renderBox(n); });
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
 * Build a standalone, self-contained SVG string of the current diagram.
 *
 * CSS variables are resolved to their current computed values so the exported
 * file renders correctly in any SVG viewer without access to styles.css.
 * The title bracket is always included when {@link diagramTitle} is set,
 * regardless of the current viewport position.
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

    // Resolve CSS custom properties to their current computed values
    const cs = getComputedStyle(document.documentElement);
    const v  = key => cs.getPropertyValue(key).trim();
    const vars = {
        'var(--bg-primary)':       v('--bg-primary')       || '#ffffff',
        'var(--text-primary)':     v('--text-primary)')    || '#1a1a18',
        'var(--accent)':           v('--accent)')           || '#185FA5',
        'var(--hdr-class)':        v('--hdr-class)')        || '#f0efec',
        'var(--hdr-class-text)':   v('--hdr-class-text)')  || '#1a1a18',
        'var(--hdr-interface)':    v('--hdr-interface)')    || 'rgba(55,138,221,0.12)',
        'var(--hdr-interface-text)': v('--hdr-interface-text)') || '#185FA5',
        'var(--hdr-enum)':         v('--hdr-enum)')         || 'rgba(99,153,34,0.12)',
        'var(--hdr-enum-text)':    v('--hdr-enum-text)')    || '#3B6D11',
        'var(--hdr-abstract)':     v('--hdr-abstract)')     || 'rgba(127,119,221,0.12)',
        'var(--hdr-abstract-text)':v('--hdr-abstract-text)')|| '#534AB7',
        'var(--arrow-inherit)':    v('--arrow-inherit)')    || 'rgba(26,26,24,0.35)',
        'var(--arrow-comp)':       v('--arrow-comp)')       || 'rgba(26,26,24,0.70)',
        'var(--arrow-agg)':        v('--arrow-agg)')        || 'rgba(26,26,24,0.55)',
        'var(--arrow-dep-use)':    v('--arrow-dep-use)')    || 'rgba(55,138,221,0.60)',
        'var(--arrow-dep-create)': v('--arrow-dep-create)') || 'rgba(99,153,34,0.60)',
    };

    // Re-render all content at identity transform (no pan/zoom offset)
    const savedVT = { ...viewTransform };
    viewTransform = { tx: PAD + TITLE_H - minX, ty: PAD + TITLE_H - minY, sc: 1 };

    let content = renderTitleBracket() + renderArrows();
    Object.keys(classMap).forEach(n => { content += renderBox(n); });

    viewTransform = savedVT;

    // Replace CSS variable references with resolved values
    Object.entries(vars).forEach(([k, val]) => {
        content = content.replaceAll(k, val);
    });

    // Build the final SVG document
    const bgColor = vars['var(--bg-primary)'];
    let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    svg += `<svg xmlns="http://www.w3.org/2000/svg" `;
    svg += `width="${viewW}" height="${viewH}" `;
    svg += `viewBox="0 0 ${viewW} ${viewH}">\n`;

    // Background
    svg += `  <rect width="${viewW}" height="${viewH}" fill="${bgColor}"/>\n`;

    // Arrow marker defs (using resolved colors)
    const arrowColor  = vars['var(--arrow-inherit)'];
    const compColor   = vars['var(--arrow-comp)'];
    svg += `  <defs>\n`;
    svg += `    <marker id="ei" viewBox="0 0 12 12" refX="11.5" refY="6" markerWidth="10" markerHeight="10" orient="auto">
      <path d="M1 1L11 6L1 11Z" fill="${bgColor}" stroke="${arrowColor}" stroke-width="1.2"/></marker>\n`;
    svg += `    <marker id="ec" viewBox="0 0 20 10" refX="0" refY="5" markerWidth="14" markerHeight="10" orient="auto">
      <path d="M0 5 L9 0.5 L18 5 L9 9.5 Z" fill="${compColor}"/></marker>\n`;
    svg += `    <marker id="ea" viewBox="0 0 20 10" refX="0" refY="5" markerWidth="14" markerHeight="10" orient="auto">
      <path d="M0 5 L9 0.5 L18 5 L9 9.5 Z" fill="${bgColor}" stroke="${arrowColor}" stroke-width="1.2"/></marker>\n`;
    svg += `    <marker id="ed" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M1 1.5L8 5L1 8.5" fill="none" stroke="${arrowColor}" stroke-width="1.5" stroke-linecap="round"/></marker>\n`;
    svg += `  </defs>\n`;

    // Replace live marker IDs with export-specific IDs
    content = content
        .replaceAll('url(#m-inh)',  'url(#ei)')
        .replaceAll('url(#m-impl)', 'url(#ei)')
        .replaceAll('url(#m-comp)', 'url(#ec)')
        .replaceAll('url(#m-agg)',  'url(#ea)')
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

    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);

    const img  = new Image();
    img.onload = () => {
        const scale  = 2;   // 2× for high-DPI screens
        const canvas = document.createElement('canvas');
        canvas.width  = img.naturalWidth  * scale;
        canvas.height = img.naturalHeight * scale;

        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);

        const pngUrl = canvas.toDataURL('image/png');
        const a      = document.createElement('a');
        a.href       = pngUrl;
        a.download   = (diagramTitle || 'uml-diagram') + '.png';
        a.click();
    };
    img.onerror = () => {
        console.error('PNG export failed: could not render SVG to canvas.');
        URL.revokeObjectURL(url);
    };
    img.src = url;
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
    list.innerHTML = Object.values(classMap).map(cls => `
        <div class="file-item${selectedClass === cls.name ? ' selected' : ''}"
             onclick="selectClass('${escapeXml(cls.name)}')">
            <span class="file-name" title="${escapeXml(cls.name)}.java">${escapeXml(cls.name)}</span>
            <button class="remove-btn"
                    onclick="event.stopPropagation(); removeClass('${escapeXml(cls.name)}')"
                    title="Remove">×</button>
        </div>
    `).join('');
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
    if (selectedClass === name) selectedClass = null;
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
    classMap      = {};
    positions     = {};
    dims          = {};
    selectedClass = null;
    viewTransform = { tx: 30, ty: 30, sc: 1 };
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

window.addEventListener('mouseup', () => { dragState = null; });


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