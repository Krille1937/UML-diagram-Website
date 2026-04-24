# Java UML Diagram Generator

An interactive, browser-based UML class diagram generator that parses uploaded `.java` source files and renders a fully interactive SVG diagram.

**Author:** Kristoffer Oltegen Diehl  
**Version:** 1.0.0

---

## Features

### Parsing
- Parses `.java` source files
- Supports classes, interfaces, enums, abstract classes, and annotation types (`@interface`)
- Extracts fields, methods, and constructors with full visibility and modifier detection
- Detects six relationship types automatically
### Relationship Detection
| Type | How it's detected |
|---|---|
| **Inheritance** | `extends` keyword |
| **Implementation** | `implements` keyword |
| **Composition** | Field whose type is another loaded class |
| **Aggregation** | Field whose type is a collection containing another loaded class |
| **«use»** | Method parameters, local variables, casts, `instanceof`, static calls, method references, catch clauses |
| **«creates»** | `new ClassName(...)`, `ClassName::new`, method return types |

Relationships are detected in priority order. if a class is already linked by composition, it won't also show as a dependency.

### Diagram Canvas
- **Pan** by clicking and dragging the canvas background
- **Zoom** with the scroll wheel, centred on the cursor
- **Drag class boxes** freely - arrows re-route automatically
- **Drag the legend box** to reposition it anywhere on the canvas
- **Fit view** button centres and scales all boxes to fill the canvas
- Sections render as a background layer and auto-resize around their assigned boxes
### Arrow Routing
- Arrows choose the shortest edge pair (top/bottom or left/right) based on the relative position of the two boxes
- Multiple arrows on the same edge are spaced evenly with no overlapping anchor points
- Slots are sorted spatially so arrows to nearby boxes get nearby slots, minimising intersecting
- Elbowed arrows snap to a straight line when endpoints are nearly aligned
- **Draggable bend handles** appear on hover - drag to push an elbow to a custom position
- Bidirectional composition/aggregation pairs collapse into a single arrow with markers at both ends
### Sidebar Controls

**Files** - drag `.java` files onto the drop zone or click to browse. Each loaded class appears in the file list with a section assignment dropdown and a remove button.

**Canvas Sections** - create named regions (e.g. "GUI", "Logic", "Data") that draw a labelled background rectangle around their assigned classes. Sections cycle through six colour tints. Names are editable inline.

**Show Members** - toggle visibility of fields, methods, and constructors independently. Hiding a category shrinks the box height immediately.

**Relationships** - toggle each detected relationship type on or off.

**Export** - export the current diagram as SVG or PNG (2× resolution). All CSS variables are resolved at export time so the file renders correctly in any viewer. The legend box is included at its current canvas position.

**Legend** - shows only the relationship types present in the current diagram, with accurate inline icons. The legend box on the canvas is draggable.

### Themes
Four colour themes selectable from the sidebar:

| Theme | Description |
|---|---|
| **Default** | Light or Dark mode via `prefers-color-scheme` |
| **Blueprint** | Dark, navy |
| **Sepia** | Light, Warm |
| **Monochrome** | High-contrast greyscale more or less if you're colorblind |

Each theme defines distinct colours for every arrow type and for field, method, and constructor identifiers inside class boxes.

---

## Usage

1. Open `https://krille1937.github.io/UML-Diagram-Website/` in a modern browser (Chrome, Firefox, Edge, Safari)
2. Drag one or more `.java` files onto the drop zone, or click it to browse
3. Classes appear as UML boxes, automatically laid out by inheritance depth
4. Use the sidebar controls to organise, filter, and style the diagram
5. Export as SVG or PNG when done

---

## File Structure

```
Index.html   - Application shell and SVG marker definitions
Styles.css   - All themes, layout, and component styles
Script.js    - Parser, relationship detection, rendering pipeline, interactions
```

---

## Limitations

- Only the **outermost** type declaration in each file is parsed. Inner classes and anonymous classes are ignored.
- Generic type bounds (`<T extends Foo>`) are not detected as relationships.
- Annotation usages (`@Override`, `@Inject`) are not drawn as dependencies.
- The body-use scanner uses heuristics (uppercase-starting identifiers) and may occasionally pick up false positives from JDK class names like `String`, `Integer`, or `System` if those classes are also loaded as files.
