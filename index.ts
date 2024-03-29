import './style.css';
import Konva from 'konva';
import { IRect, Vector2d } from 'konva/types/types';
import { Observable, Subject, fromEvent, Subscription } from 'rxjs';
import {KonvaEventListener, KonvaEventObject} from "konva/types/Node";

// Solution little improved with layer relative scale (zoom) taken from https://stackoverflow.com/questions/56866900/konvajs-how-to-keep-the-position-and-rotation-of-the-shape-in-the-group-after-d
function decompose(mat, layer: Konva.Layer) {
  var a = mat[0];
  var b = mat[1];
  var c = mat[2];
  var d = mat[3];
  var e = mat[4];
  var f = mat[5];

  var delta = a * d - b * c;
  const position = layer.getAbsolutePosition();
  const scale = layer.getAbsoluteScale();

  let result = {
    x: (e - position.x) / scale.x,
    y: (f - position.y) / scale.y,
    rotation: 0,
    scaleX: 0,
    scaleY: 0,
    skewX: 0,
    skewY: 0,
  };

  if (a != 0 || b != 0) {
    var r = Math.sqrt(a * a + b * b);
    result.rotation = b > 0 ? Math.acos(a / r) : -Math.acos(a / r);
    result.scaleX = r / scale.x;
    result.scaleY = delta / r / scale.y;
    result.skewX = Math.atan((a * c + b * d) / (r * r));
  } else if (c != 0 || d != 0) {
    var s = Math.sqrt(c * c + d * d);
    result.rotation =
      Math.PI / 2 - (d > 0 ? Math.acos(-c / s) : -Math.acos(c / s));
    result.scaleX = delta / s / scale.x;
    result.scaleY = s / scale.y;
    result.skewX = 0
    result.skewY = Math.atan((a * c + b * d) / (s * s));
  } else {
    a = b = c = d = 0
  }

  result.rotation *= 180 / Math.PI;
  return result;
}

function haveIntersection(r1, r2): boolean {
  return !(
    r2.x > r1.x + r1.width ||
    r2.x + r2.width < r1.x ||
    r2.y > r1.y + r1.height ||
    r2.y + r2.height < r1.y
  );
}

function reverse(r1, r2): { [k: string]: any } {
  let r1x: number = r1.x;
  let r1y: number = r1.y;
  let r2x: number = r2.x;
  let r2y: number = r2.y;
  let d: number;

  if (r1x > r2x ){
    d = Math.abs(r1x - r2x);
    r1x = r2x; r2x = r1x + d;
  }

  if (r1y > r2y ){
    d = Math.abs(r1y - r2y);
    r1y = r2y; r2y = r1y + d;
  }

  return {
    x1: r1x, 
    y1: r1y, 
    x2: r2x, 
    y2: r2y
  };    
}

function getRelativePointerPosition(node: Konva.Node): Vector2d {
  const transform = node.getAbsoluteTransform().copy();
  transform.invert();
  return transform.point(node.getStage().getPointerPosition());
}

class KonvaSelection {
  private readonly EVENT_NAME = 'konva-selection';
  private readonly ORIGINAL_INDEX_ATTR = 'originalIndex';
  private selectionChange$: Subject<any> = new Subject();
  private bounding: Konva.Group;
  private selectBox: Konva.Rect;
  private oldPosition: Vector2d;
  private selectAttrs: { 
    posStart: Vector2d, 
    posNow: Vector2d, 
    select: boolean
  } = {
    posStart: null,
    posNow: null,
    select: false
  }

  layer: Konva.Group;
  nodes: Map<number, Konva.Node>;
  transformer: Konva.Transformer;

  constructor(layer: Konva.Group, nodes?: Array<Konva.Node>) {

    this.nodes = new Map();
    this.layer = layer;

    this.initializeEvent();

    if (!Array.isArray(nodes)) {
      return;
    }

    for (const node of nodes) {
      this.nodes.set(node._id, node);
    }
  }

  /**
   * Observe selection change event
   */
  change(): Observable<any> {
    return this.selectionChange$.asObservable();
  }

  /**
   * Add node to selection list
   * @param node
   */
  add(node: Konva.Node): void {
    if (!this.nodes.has(node._id)) {
      this.nodes.set(node._id, node);
      this.selectionChange$.next(this.nodes);

      if (!this.transformer) {
        this.layer.add(this.createTransformer());
      }

      // set group or node and force transformer update with new dimensions
      this.updateTransformer();
    }
  }

  /**
   * Remove node from selection list
   * @param node
   */
  remove(node: Konva.Node): void {
    this.nodes.delete(node._id);
    this.selectionChange$.next(this.nodes);

    if (this.transformer) {

      // set group or node and force transformer update with new dimensions
      this.updateTransformer();
    }
  }

  /**
   * Create bounding group for transformer node update
   */
  createBounding(): Konva.Group {
    if (this.bounding) {
      this.bounding.destroy();
    }

    this.bounding = new Konva.Group();

    this.nodes.forEach((node: Konva.Node) => {
      const clone: Konva.Shape = node.clone();
      clone.setAttr(this.ORIGINAL_INDEX_ATTR, node._id);
      this.bounding.add(clone);
    });

    this.bounding.visible(false);
    this.layer.add(this.bounding);

    return this.bounding;
  }

  /**
   * Init selection event
   */
  initializeEvent(): void {
    const stage: Konva.Stage = this.layer.getStage();
    const layer: Konva.Layer = this.layer.getLayer() as Konva.Layer;

    // Solution little improved taken from https://stackoverflow.com/questions/44958281/drag-selection-of-elements-not-in-group-in-konvajs
    this.layer.getLayer()
      .on('dragstart.' + this.EVENT_NAME, (e) => {
        this.oldPosition = e.target.position();
      })
      .on('dragmove.' + this.EVENT_NAME, (e) => {
        const diffPos: Vector2d = {
          x: e.target.x() - this.oldPosition.x,
          y: e.target.y() - this.oldPosition.y
        };

        this.nodes.forEach((child) => {
          if (child === e.target) {
            return;
          }

          child.move(diffPos);
        });

        this.oldPosition = e.target.position();
        this.updateTransformer();
      });

    stage
      .on('mousedown.' + this.EVENT_NAME, (e) => {

        // Selection process onmousedown event
        if (e.target === stage) {

          // Deselect all
          this.clear();

          this.selectAttrs.select = true;

          if (!this.selectBox) {
            this.layer.getLayer().add(this.createSelectBox());
          }

          this.startDrag(getRelativePointerPosition(this.layer.getLayer()));
        }

        if (e.target.hasName('entity')) {

          // Use shift key for multiple selection
          if (!e.evt.shiftKey && !this.nodes.has(e.target._id)) {
            this.clear();
          }

          // Add node to selection
          this.add(e.target);
        }
      })
      .on('mousemove.' + this.EVENT_NAME, (e: any) => { 
          if (this.selectAttrs.select){
            this.updateDrag(getRelativePointerPosition(this.layer.getLayer()));
          }
      })
      .on('mouseup.' + this.EVENT_NAME, (e: any) => { 
        this.destroySelectBox();
      })
      .on('wheel.' + this.EVENT_NAME, () => {

        // Update transformer when scale stage
        this.updateTransformer();
      });
  }

  /**
   * Create selection transformer
   */
  createTransformer(): Konva.Transformer {
    this.transformer = new Konva.Transformer();

    this.transformer
      .on('transform.' + this.EVENT_NAME, (e) => {

        // If multiple selection, retrieve absolute position from group context for each node
        const group: Konva.Node = this.transformer.getNode();

        for (const child of group.children.toArray()) {
          const node: Konva.Node = this.nodes.get(child.attrs[this.ORIGINAL_INDEX_ATTR]);

          if (node) {
            node
              .setAttrs(
                decompose(
                  child.getAbsoluteTransform().getMatrix(), this.layer.getLayer() as Konva.Layer
                )
              );
          }          
        }
      })

    return this.transformer;
  }

  /**
   * Check if multiple selection
   */
  isGroup(): boolean {
    return this.nodes.size > 1;
  }

  /**
   * Update transformer with node or bounding group
   */
  updateTransformer(): void {
    if (!this.transformer) {
      return;
    }

    // Attach node or bounding group if selection is multiple
    this.transformer
      .attachTo(!this.isGroup()
        ? this.nodes.values().next().value 
        : this.createBounding()
      )
      .forceUpdate();  
  }

  /**
   * Create select box
   */
  createSelectBox(): Konva.Rect {
    this.selectBox = new Konva.Rect({
      x: 0, 
      y: 0, 
      width: 0, 
      height: 0, 
      stroke: '#1D83FF',
      strokeWidth: .8,
      fill: 'rgba(29, 131, 255, .2)',
      listening: false,
      id: 'selectBox'
    });

    return this.selectBox;
  }

  /**
   * Destroy select box instance
   */
  destroySelectBox(): void {
    if (this.selectAttrs.select) {
      this.selectAttrs.select = false;
      this.selectBox.destroy();
      this.selectBox = null;
      this.layer.getLayer().draw();
    }
  }

  /**
   * Set cursor position for select box
   */
  startDrag(posIn: Vector2d): void {
    this.selectAttrs.posStart = {
      x: posIn.x, 
      y: posIn.y
    };
    this.selectAttrs.posNow = {
      x: posIn.x, 
      y: posIn.y
    };
  }

  /**
   * Update select box dimension when dragging
   */
  updateDrag(posIn: Vector2d): void { 
    this.selectAttrs.posNow = {
      x: posIn.x, 
      y: posIn.y
    };

    var posRect = reverse(this.selectAttrs.posStart, this.selectAttrs.posNow);

    this.selectBox.setAttrs({
      x: posRect.x1,
      y: posRect.y1,
      width: posRect.x2 - posRect.x1,
      height: posRect.y2 - posRect.y1,
      visible: true,  
    });

    const nodes: Array<Konva.Node> = layer1.children.toArray().filter((n) => {
      return n.id() !== 'selectBox';
    });

    const selectBoxRect = this.selectBox.getClientRect({
      skipStroke: true,
      skipShadow: true
    });
  
    // run the collision check loop
    for (let i = 0; i < nodes.length; i = i + 1){
      if (
        haveIntersection(nodes[i].getClientRect(), selectBoxRect)
        && nodes[i].hasName('entity')
      ) {
        this.add(nodes[i]);
      } else {
        this.remove(nodes[i]);
      }
    }
    
    layer.draw(); 
  }

  /**
   * Get bounding group to get absolute position of selection
   */
  getBounding(): Konva.Group {
    return this.bounding;
  }

  /**
   * Clear transformer and clear selection
   */
  clear(): void {
    if (this.transformer) {
      this.transformer.destroy();
      this.transformer = null;
    }

    this.nodes.clear();
  }

  /**
   * Transform nodes map to array of nodes
   */
  toArray<T>(): Array<T> {
    const output = [];

    this.nodes.forEach((n: Konva.Node) => {
      output.push(n);
    });

    return output;
  }

  /**
   * Clone nodes map to array of nodes
   */
  clone<T>(): Array<T> {
    const output = [];

    this.nodes.forEach((n: Konva.Node) => {
      output.push(n.clone());
    });

    return output;
  }
}

const stage = new Konva.Stage({
  container: 'container',
  width: 658,
  height: 300,
  draggable: false
});

const layer = new Konva.Layer();
stage.add(layer);

const layer1 = new Konva.Group({
  draggable: false
});
const colors = ['red', 'green', 'blue'];

for (let i = 1; i < 4; i++) {
  const radius = i % 2 === 0 ? 30 : 50;

  const c = new Konva.Line({
    points: [0, 0, radius, 0, radius, radius, 0, radius],
    closed: true,
    x: 100 * i,
    y: 100,
    fill: colors[Math.floor((Math.random()*colors.length))],
    draggable: true,
    name: 'entity',
    strokeScaleEnabled: false,
    hitStrokeWidth: 5,
    strokeWidth: 1,
    tension: i % 2 === 0 ? 0.55 : null
  });

  layer1.add(c);
}

layer.add(layer1);
layer.draw();

const selection = new KonvaSelection(layer1);

const zIndex: HTMLInputElement = document.querySelector('#z-index');

if (zIndex) {
  for (let i = 0; i < 4; i++) {
    const option = document.createElement('option');
    option.label = 'index ' + i;
    option.setAttribute('value', i.toString());

    zIndex.appendChild(option);
  }

  zIndex.onchange = (e: any) => {
    selection.nodes.forEach((n) => n.zIndex(+e.target.value));
    selection.transformer.zIndex(3)
    layer.batchDraw();
  };

  selection
    .change()
    .subscribe((s: Map<number, Konva.Node>) => {
      if (s.size === 1) {
        zIndex.value = s.values().next().value.zIndex();
      }
    });
}

const top: HTMLButtonElement = document.querySelector('#top');
const bottom: HTMLButtonElement = document.querySelector('#bottom');

top.onclick = () => {
  selection.nodes.forEach((n: Konva.Node) => {
    n.moveToTop();
    selection.transformer.moveToTop();
    layer.batchDraw();
  })
}

bottom.onclick = () => {
  selection.nodes.forEach((n: Konva.Node) => {
    n.moveToBottom();
    selection.transformer.moveToTop();
    layer.batchDraw();
  })
}

const scaleBy = 1.04;

stage.on('wheel', e => {
  e.evt.preventDefault();
  var oldScale = stage.scaleX();

  var mousePointTo = {
    x: stage.getPointerPosition().x / oldScale - stage.x() / oldScale,
    y: stage.getPointerPosition().y / oldScale - stage.y() / oldScale
  };

  var newScale =
    e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
  stage.scale({ x: newScale, y: newScale });

  var newPos = {
    x:
      -(mousePointTo.x - stage.getPointerPosition().x / newScale) *
      newScale,
    y:
      -(mousePointTo.y - stage.getPointerPosition().y / newScale) *
      newScale
  };

  stage.position(newPos);
  stage.batchDraw();
});

const canvas: HTMLDivElement = stage.container();
let focus: boolean;

canvas.onmouseenter = () => {
  focus = true;
}

canvas.onmouseleave = () => {
  focus = false;
}

document.body.onkeydown = (e) => {
  if (focus) {
    switch(e.code) {
      case 'Space':
        stage.draggable(true);
        canvas.style.cursor = 'grab';
        break;
    }
  }       
}

document.body.onkeyup = (e) => {
  stage.draggable(false);
  canvas.style.cursor = 'default';
}

enum ContextToolType {
  Copy,
  Cut,
  Paste
}

interface IContextToolClipboard {
  entities: Array<Konva.Shape>;
  type: ContextToolType;
}

interface IContextToolHandler {
  (position: {x: number, y: number }, clipboard: IContextToolClipboard): void;
}

interface IContextToolConfig {
  stage: Konva.Stage;
  actions: Array<Array<IContextToolActionConfig>>;
}

interface IContextToolActionConfig {
  label: string;
  visible?: (target: Konva.Node, clipboard: IContextToolClipboard) => boolean;
  handler: IContextToolHandler;
}

interface IPosition {
  x: number;
  y: number;
}

class ContextTool {
  actions: Array<Array<IContextToolActionConfig>>;
  contextElement: HTMLDivElement;
  contextElementPosition: IPosition;
  contextOverlay: HTMLDivElement;
  contextSubscription: Subscription;
  clipboard: IContextToolClipboard;
  closed$: Subject<void> = new Subject<void>();

  constructor(config: IContextToolConfig) {
    try {
      if (!config.stage) {
        throw new Error('Context Tool error: You must provide konva stage');
      }

      this.clipboard = {
        entities: [],
        type: null
      }

      this.contextSubscription = new Subscription();

      // On stage contextmenu click, create context panel and overlay
      config.stage.on('contextmenu', (e: KonvaEventObject<MouseEvent>) => {

        // Kill default context menu
        e.evt.preventDefault();
        
        this.contextElement = this.buildContextPanel(e); 
        this.contextOverlay = this.buildContextOverlay();

        this.contextOverlay.appendChild(this.contextElement);
        document.body.appendChild(this.contextOverlay);
      });
    } catch (e) {
      console.error(e);
    }
  }

  /**
   * Create ContextTool instance
   */
  public static create(config: IContextToolConfig): ContextTool {
    const instance: ContextTool = new ContextTool(config);
    instance.actions = config.actions;
    return instance;
  }

  /**
   * Create context panel
   */
  buildContextPanel(e: KonvaEventObject<MouseEvent>): HTMLDivElement {
    const panel: HTMLDivElement = document.createElement('div');
    panel.classList.add('context-panel');

    this.contextElementPosition = {
      x: e.evt.clientX,
      y: e.evt.clientY
    };

    Object.assign(panel.style, {
      position: 'absolute',
      zIndex: '99999',
      top: this.contextElementPosition.y + 'px',
      left: this.contextElementPosition.x + 'px',
      background: '#252526',
      width: '200px',
      border: '1px solid rgba(255, 255, 255, .1)',
      borderRadius: '3px'
    });

    let i = 0;

    for (const group of this.actions) {
      console.log(i === this.actions.length - 1);
      const groupElement: HTMLDivElement = this.buildContextPanelGroup(i === this.actions.length - 1);

      for (const action of group) {
        if (action.visible) {
          if(action.visible(e.target, this.clipboard)) {
            groupElement.appendChild(this.buildContextPanelHandler(action));
          }
        } else {
          groupElement.appendChild(this.buildContextPanelHandler(action));
        }
      }

      panel.appendChild(groupElement);
      i++;
    }

    return panel;
  }

  /**
   * Create context panel group
   */
  buildContextPanelGroup(last = false): HTMLDivElement {
    const group: HTMLDivElement = document.createElement('div');
    group.classList.add('context-panel-group');

    if (!last) {
      Object.assign(group.style, {
        borderBottom: '1px solid rgba(255, 255, 255, .1)'
      });
    }

    return group;
  }

  /**
   * Create context panel handler
   */
  buildContextPanelHandler(item: IContextToolActionConfig): HTMLDivElement {
    const handler: HTMLDivElement = document.createElement('div');
    handler.classList.add('context-panel-item');
    handler.innerHTML = item.label;

    Object.assign(handler.style, {
      padding: '10px',
      transition: 'all .2s ease',
      color: 'white',
      cursor: 'pointer'
    });

    handler.onmouseover = () => {
      Object.assign(handler.style, {
        backgroundColor: '#1E1E1E'
      });
    }

    handler.onmouseleave = () => {
      Object.assign(handler.style, {
        backgroundColor: 'transparent'
      });
    }

    handler.onmousedown = () => {
      Object.assign(handler.style, {
        backgroundColor: 'rgba(255, 255, 255, .1)'
      });
    }

    handler.onclick = (evt: MouseEvent) => {
      evt.stopPropagation();
      this.handlerWrapperFn(item.handler);
    }

    return handler;
  }

  /**
   * Create context panel overlay
   */
  buildContextOverlay(): HTMLDivElement {
    const overlay: HTMLDivElement = document.createElement('div');
    overlay.classList.add('context-panel-overlay');

    Object.assign(overlay.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%'
    });

    overlay.onclick = () => {
      if (this.contextElement) {
        this.contextElement.remove();
      }

      if (this.contextOverlay) {
        this.contextOverlay.remove();
      }
    };

    return overlay;
  }

  /**
   * Wrap handler fn to execute pre or post fn
   */
  handlerWrapperFn(handler: IContextToolHandler) {
    handler(this.contextElementPosition, this.clipboard);
    
    if (this.contextElement) {
      this.contextElement.remove();
    }

    if (this.contextOverlay) {
      this.contextOverlay.remove();
      this.closed$.next();
    }
  }

  /**
   * Observe closed event (overlay click)
   */
  onClosed(): Observable<void> {
    return this.closed$.asObservable();
  }
}

const contextTool = ContextTool.create(<IContextToolConfig>{
  stage: stage,
  actions: [
    [
      <IContextToolActionConfig>{
        label: 'Copy',
        visible: (target: Konva.Node) => target.hasName('entity'),
        handler: (position: IPosition, clipboard: IContextToolClipboard) => {
          clipboard.entities = selection.clone();
          clipboard.type = ContextToolType.Copy;
          console.log('copy');
        }
      },
      <IContextToolActionConfig>{
        label: 'Cut',
        visible: (target: Konva.Node) => target.hasName('entity'),
        handler: (position: IPosition, clipboard: IContextToolClipboard) => {
          clipboard.entities = selection.toArray();
          clipboard.type = ContextToolType.Cut;
          clipboard.entities.forEach((entity: Konva.Shape) => entity.visible(false));

          selection.clear();
          layer.batchDraw();
          console.log('cut');
        }
      },  
      <IContextToolActionConfig>{
        label: 'Paste',
        visible: (target: Konva.Node, clipboard: IContextToolClipboard) => {
          return clipboard.entities.length > 0;
        },
        handler: (position: IPosition, clipboard: IContextToolClipboard) => {
          if (clipboard.entities.length) {

            // @todo: Keep element position on cut or copy (group mode)
            if (selection.isGroup()) {
              const bounding: Konva.Group = selection.getBounding();
              const children = bounding.children.toArray();

              /* const entityFromBounding = children.find((child) => {
                  child._id === entity.attrs.originalIndex;
                });

                console.log(entityFromBounding); */
            }
            
            for (const entity of clipboard.entities) {
              if (clipboard.type === ContextToolType.Copy) {
                layer1.add(entity);
              }

              entity
                .visible(true)
                .x(position.x)
                .y(position.y);
            }

            layer.batchDraw();
            console.log('paste');
          }
        }
      }
    ],
    [
      <IContextToolActionConfig>{
        label: 'Delete',
        visible: (target: Konva.Node) => target.hasName('entity'),
        handler: (position: IPosition, clipboard: IContextToolClipboard) => {
          selection.nodes.forEach((n: Konva.Node) => {
            n.destroy();
          });

          selection.clear();
          layer.batchDraw();
        }
      }
    ],
    [
      <IContextToolActionConfig>{
        label: 'Move forward',
        visible: (target: Konva.Node) => target.hasName('entity'),
        handler: (position: IPosition, clipboard: IContextToolClipboard) => {
          selection.nodes.forEach((n: Konva.Node) => {
            n.moveUp();
            selection.transformer.moveToTop();
          });

          layer.batchDraw();
        }
      },
      <IContextToolActionConfig>{
        label: 'Move backward',
        visible: (target: Konva.Node) => target.hasName('entity'),
        handler: (position: IPosition, clipboard: IContextToolClipboard) => {
          selection.nodes.forEach((n: Konva.Node) => {
            n.moveDown();
            selection.transformer.moveToTop();
          });

          layer.batchDraw();
        }
      }
    ]
  ]
});

contextTool.onClosed().subscribe(() => selection.destroySelectBox());