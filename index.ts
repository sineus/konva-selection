import './style.css';
import Konva from 'konva';
import { IRect, Vector2d } from 'konva/types/types';
import { Observable, Subject } from 'rxjs';
import {KonvaEventListener} from "konva/types/Node";

let queue = [];

const Util = {
  requestAnimFrame(callback: Function) {
    queue.push(callback);
    if (queue.length === 1) {
      requestAnimationFrame(function() {
        const anims = queue;
        queue = [];
        anims.forEach(function(cb) {
          cb();
        });
      });
    }
  }
}

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

class KonvaSelection {
  private readonly ORIGINAL_INDEX_ATTR = 'originalIndex';
  private selectionChange$: Subject<any> = new Subject();
  private bounding: Konva.Group;
  private oldPosition: Vector2d;

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

    // Solution little improved taken from https://stackoverflow.com/questions/44958281/drag-selection-of-elements-not-in-group-in-konvajs
    this.layer.getLayer()
      .on('dragstart.konva-selection', (e) => {
        this.oldPosition = e.target.position();
      })
      .on('dragmove.konva-selection', (e) => {
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
      .on('mousedown.konva-selection', (e) => {

        // Selection process onmousedown event
        if (e.target === stage) {

          // Deselect all
          this.clear();
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
      .on('wheel', () => {

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
      .on('transform', (e) => {

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
   * Clear transformer and clear selection
   */
  clear(): void {
    if (this.transformer) {
      this.transformer.destroy();
      this.transformer = null;
    }

    this.nodes.clear();
  }

  toArray<T>(): Array<T> {
    const output = [];

    this.nodes.forEach((n: Konva.Node) => {
      output.push(n);
    });

    return output;
  }
}

const stage = new Konva.Stage({
  container: 'container',
  width: 400,
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
    selection.transformer.zIndex(3);
    layer.batchDraw();
  })
}

bottom.onclick = () => {
  selection.nodes.forEach((n: Konva.Node) => {
    n.moveToBottom();
    selection.transformer.zIndex(3);
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

// draw a rectangle to be used as the rubber area
const selectBox = new Konva.Rect({
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

layer1.add(selectBox)

let posStart: Vector2d;
let posNow: Vector2d;
let select: boolean;

function startDrag(posIn: Vector2d){
  posStart = {
    x: posIn.x, 
    y: posIn.y
  };
  posNow = {
    x: posIn.x, 
    y: posIn.y
  };
}

function updateDrag(posIn: Vector2d){ 
  
  // update rubber rect position
  posNow = {
    x: posIn.x, 
    y: posIn.y
  };

  var posRect = reverse(posStart, posNow);

  selectBox.setAttrs({
    x: posRect.x1,
    y: posRect.y1,
    width: posRect.x2 - posRect.x1,
    height: posRect.y2 - posRect.y1,
    visible: true,  
  });

  const nodes: Array<Konva.Node> = layer1.children.toArray().filter((n) => {
    return n.id() !== 'selectBox';
  });

  const selectBoxRect = selectBox.getClientRect({
    skipStroke: true,
    skipShadow: true
  });
 
  // run the collision check loop
  for (let i = 0; i < nodes.length; i = i + 1){
    if (
      haveIntersection(nodes[i].getClientRect(), selectBoxRect)
      && nodes[i].hasName('entity')
    ) {
      selection.add(nodes[i]);
    } else {
      selection.remove(nodes[i]);
    }
  }
  
  layer.draw();
  
}

stage
  .on('mousedown', (e: any) => { 
    if (e.target === stage) {
      select = true;
      startDrag({
        x: e.evt.layerX, 
        y: e.evt.layerY
      });
    }
  })
  .on('mousemove', (e: any) => { 
      if (select){
        updateDrag({
          x: e.evt.layerX, 
          y: e.evt.layerY
        });
      }
  })
  .on('mouseup', (e: any) => { 
      select = false;
      selectBox.visible(false);
      layer.draw();
  });

function haveIntersection(r1, r2): boolean {
  return !(
    r2.x > r1.x + r1.width ||
    r2.x + r2.width < r1.x ||
    r2.y > r1.y + r1.height ||
    r2.y + r2.height < r1.y
  );
}

// reverse co-ords if user drags left / up
function reverse(r1, r2){
  var r1x = r1.x, r1y = r1.y, r2x = r2.x,  r2y = r2.y, d;
  if (r1x > r2x ){
    d = Math.abs(r1x - r2x);
    r1x = r2x; r2x = r1x + d;
  }
  if (r1y > r2y ){
    d = Math.abs(r1y - r2y);
    r1y = r2y; r2y = r1y + d;
  }
    return ({x1: r1x, y1: r1y, x2: r2x, y2: r2y}); // return the corrected rect.     
}