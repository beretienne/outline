import { NodeSelection } from "prosemirror-state";
import { uploadedImageNode } from "../commands/insertFiles";
import {
  createEditorState,
  extensionManager,
  p,
  schema,
  serializer,
} from "@shared/test/editor";
import Figure from "./Figure";

function image(attrs: Record<string, unknown> = {}) {
  return schema.nodes.image.create({
    src: "/uploads/pic.png",
    alt: "A camera",
    ...attrs,
  });
}

function figureCommand() {
  const figure = extensionManager.extensions.find(
    (extension) => extension instanceof Figure
  );
  if (!(figure instanceof Figure)) {
    throw new Error("Figure extension not registered");
  }
  return figure.commands({ type: schema.nodes.figure }).figure();
}

function runFigureCommand(
  testDoc: ReturnType<typeof schema.nodes.doc.create>,
  imagePos: number
) {
  let state = createEditorState(testDoc);
  state = state.apply(
    state.tr.setSelection(NodeSelection.create(state.doc, imagePos))
  );
  const applied = figureCommand()(state, (tr) => {
    state = state.apply(tr);
  });
  return { applied, doc: state.doc };
}

describe("Figure figure command", () => {
  it("wraps an image alone in its paragraph in a figure-md", () => {
    const testDoc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, image()),
    ]);
    const { applied, doc } = runFigureCommand(testDoc, 1);

    expect(applied).toBe(true);
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild?.type.name).toBe("figure");
    expect(doc.firstChild?.attrs.directive).toBe("figure-md");
    expect(doc.firstChild?.firstChild?.attrs.alt).toBe("A camera");
    expect(() => doc.check()).not.toThrow();
    expect(serializer.serialize(doc).trim()).toBe(
      "```{figure-md}\n![](/uploads/pic.png)\n\nA camera\n\n```"
    );
  });

  it("declines an image in the middle of a sentence", () => {
    const testDoc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [schema.text("See "), image()]),
    ]);
    const { applied, doc } = runFigureCommand(testDoc, 5);

    expect(applied).toBe(false);
    expect(doc.firstChild?.type.name).toBe("paragraph");
  });

  it("declines when the selection is not an image", () => {
    const testDoc = schema.nodes.doc.create(null, [p("text")]);
    const state = createEditorState(testDoc);

    expect(figureCommand()(state)).toBe(false);
  });
});

describe("uploadedImageNode", () => {
  it("is the bare image by default", () => {
    expect(uploadedImageNode(schema, { src: "/a.png" }).type.name).toBe(
      "image"
    );
  });

  it("is a figure-md holding the image when asked", () => {
    const node = uploadedImageNode(schema, { src: "/a.png" }, true);

    expect(node.type.name).toBe("figure");
    expect(node.attrs.directive).toBe("figure-md");
    expect(node.firstChild?.attrs.src).toBe("/a.png");
  });
});
