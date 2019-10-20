import Konva from 'konva';
import { IRect } from 'konva/types/types';
import { Observable, Subject } from 'rxjs';

function decompose(mat) {
  var a = mat[0];
  var b = mat[1];
  var c = mat[2];
  var d = mat[3];
  var e = mat[4];
  var f = mat[5];

  var delta = a * d - b * c;

  let result = {
    x: e,
    y: f,
    rotation: 0,
    scaleX: 0,
    scaleY: 0,
    skewX: 0,
    skewY: 0,
  };

  if (a != 0 || b != 0) {
    var r = Math.sqrt(a * a + b * b);
    result.rotation = b > 0 ? Math.acos(a / r) : -Math.acos(a / r);
    result.scaleX = r;
    result.scaleY = delta / r;
    result.skewX = Math.atan((a * c + b * d) / (r * r));
  } else if (c != 0 || d != 0) {
    var s = Math.sqrt(c * c + d * d);
    result.rotation =
      Math.PI / 2 - (d > 0 ? Math.acos(-c / s) : -Math.acos(c / s));
    result.scaleX = delta / s
    result.scaleY = s;
    result.skewX = 0
    result.skewY = Math.atan((a * c + b * d) / (s * s));
  } else {
    a = b = c = d = 0
  }

  result.rotation *= 180 / Math.PI;
  return result;
}

class KonvaSelection {
  private selectionChange$: Subject<any> = new Subject();

  layer: Konva.Layer;
  nodes: Map<number, Konva.Node>;
  transformer: Konva.Transformer;

  constructor(layer: Konva.Layer, nodes?: Array<Konva.Node>) {

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

  change(): Observable<any> {
    return this.selectionChange$.asObservable();
  }

  /**
   * Add node to selection list
   */
  add(node: Konva.Node): void {
    if (!this.nodes.has(node._id)) {
      this.nodes.set(node._id, node);
      this.selectionChange$.next(this.nodes);

      if (!this.transformer) {
        this.layer.add(this.createTransformer());
      }
    }
  }

  /**
   * Remove node from selection list
   */
  remove(node: Konva.Node): void {
    this.nodes.delete(node._id);
    this.selectionChange$.next(this.nodes);
  }

  /**
   * Create bounding group to get absolute selection clientRect
   */
  createBounding(rotation: number): Konva.Group {
    const bounding: Konva.Group = new Konva.Group();

    this.nodes.forEach((node: Konva.Node) => {
      const clone: Konva.Shape = node.clone();
      clone.setAttr('originalIndex', node._id);
      bounding.add(clone);
    });

    return bounding;
  }

  /**
   * Init selection event
   */
  initializeEvent() {
    let oldX: number;
    let oldY: number;
    const stage: Konva.Stage = this.layer.getStage();

    this.layer
      .on('dragstart.konva-selection', (e) => {
        oldX = e.target.x();
        oldY = e.target.y();
      })
      .on('dragmove.konva-selection', (e) => {
        const diffX = e.target.x() - oldX;
        const diffY = e.target.y() - oldY;

        this.nodes.forEach((child) => {
          if (child === e.target) {
            return;
          }

          child.x(child.x() + diffX);
          child.y(child.y() + diffY);
        });

        oldX = e.target.x();
        oldY = e.target.y();

        this.updateTransformer();
      });

    stage
      .on('mousedown.konva-selection', (e) => {
        if (e.target === stage) {
          this.clear();
        }

        if (e.target.hasName('entity')) {

          let exist: boolean = false;

          selection.nodes.forEach((n: Konva.Node) => {
            if (n === e.target) {
              exist = true;
            }
          });

          if (!e.evt.shiftKey && !exist) {
            this.clear();
          }

          this.add(e.target);

          if (!exist) {
            this.updateTransformer();
          }
        }

        layer.batchDraw();
      });
  }

  /**
   * Get selection client rect
   */
  getClientRect(): IRect {
    const bounding: Konva.Group = this.createBounding();

    return bounding.getClientRect({
      skipShadow: true,
      skipStroke: true
    });
  }

  /**
   * Create selection transformer
   */
  createTransformer(): Konva.Transformer {
    this.transformer = new Konva.Transformer();

    this.transformer
      .on('transform', (e) => {
        const group: Konva.Node = this.transformer.getNode();

        for (const child of group.children.toArray()) {
          const node: Konva.Node = this.nodes.get(child.attrs.originalIndex);

          if (node) {
            node
              .setAttrs(
                decompose(
                  child.getAbsoluteTransform().getMatrix()
                )
              );
          }          
        }
      })

    return this.transformer;
  }

  isGroup(): boolean {
    return this.nodes.size > 1;
  }

  /**
   * Update transformer with new bounding client rect
   */
  updateTransformer(): void {
    if (!this.transformer) {
      return;
    }

    const isGroup: boolean = this.nodes.size === 1;
    const rotation: number = this.transformer.getRotation();

    this.transformer
      .attachTo(isGroup 
        ? this.nodes.values().next().value 
        : this.createBounding(rotation)
      )
      .forceUpdate();  
  }

  // Clear transformer and clear selection
  clear(): void {
    if (this.transformer) {
      this.transformer.destroy();
      this.transformer = null;
    }

    this.nodes.clear();
  }
}

const stage = new Konva.Stage({
  container: 'container',
  width: window.innerWidth,
  height: window.innerHeight
});

const layer = new Konva.Layer();
stage.add(layer);

const selection = new KonvaSelection(layer);
const colors = ['red', 'green', 'blue'];

for (let i = 1; i < 4; i++) {
  const c = new Konva.Circle({
    x: 100 * i,
    y: 100 * i,
    radius: 30,
    fill: colors[Math.floor((Math.random()*colors.length))],
    draggable: true,
    name: 'entity'
  });

  layer.add(c);
}

layer.draw();

const zIndex: HTMLInputElement = document.querySelector('#z-index');

if (zIndex) {
  for (let i = 0; i < 4; i++) {
    const option = document.createElement('option');
    option.label = 'index ' + i;
    option.setAttribute('value', i.toString());

    zIndex.appendChild(option);
  }

  zIndex.onchange = (e) => {
    selection.nodes.forEach((n) => n.zIndex(+e.target.value));
    selection.transformer.zIndex(3)
    layer.batchDraw();
  };

  selection
    .change()
    .subscribe((s: Map<number, Konva.Node>) => {
      console.log(s)
      if (s.size === 1) {
        zIndex.value = s.values().next().value.zIndex();
      }
    });
}

const top: HTMLButtonElement = document.querySelector('#top');
const bottom: HTMLButtonElement = document.querySelector('#bottom');

top.onclick = () => {
  console.log(selection);
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

