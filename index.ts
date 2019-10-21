import Konva from 'konva';
import { IRect, Vector2d } from 'konva/types/types';
import { Observable, Subject } from 'rxjs';

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
        console.log(this.layer);
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
  createBounding(): Konva.Group {
    if (this.bounding) {
      this.bounding.destroy();
    }

    this.bounding = new Konva.Group();

    this.nodes.forEach((node: Konva.Node) => {
      const clone: Konva.Shape = node.clone();
      clone.setAttr('originalIndex', node._id);
      this.bounding.add(clone);
    });

    this.bounding.visible(false);
    this.layer.add(this.bounding);

    return this.bounding;
  }

  /**
   * Init selection event
   */
  initializeEvent() {
    const stage: Konva.Stage = this.layer.getStage();

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
        if (e.target === stage) {
          this.clear();
        }

        if (e.target.hasName('entity')) {
          let exist: boolean = false;

          this.nodes.forEach((n: Konva.Node) => {
            if (n === e.target) {
              exist = true;
            }
          });

          if (!e.evt.shiftKey && !exist) {
            this.clear();
          }

          this.add(e.target);
          this.updateTransformer();
        }
      })
      .on('wheel', () => {
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
        const group: Konva.Node = this.transformer.getNode();

        for (const child of group.children.toArray()) {
          const node: Konva.Node = this.nodes.get(child.attrs.originalIndex);

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

    this.transformer
      .attachTo(this.nodes.size === 1 
        ? this.nodes.values().next().value 
        : this.createBounding()
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
  width: 1920,
  height: 1080,
  draggable: true
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

  stage.find('Transformer').each((n) => {
    console.log(n);
  })

  stage.position(newPos);
  stage.batchDraw();
});

