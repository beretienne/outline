import { Node } from "prosemirror-model";
import {
  doc,
  parser,
  schema,
  serializer,
  table,
  td,
  th,
  tr,
} from "../../../test/editor";

describe("code fences", () => {
  it("serializes code blocks containing backtick runs with a longer fence", () => {
    const doc = Node.fromJSON(schema, {
      type: "doc",
      content: [
        {
          type: "code_block",
          content: [
            { type: "text", text: "one\n``` not a closing fence\nthree" },
          ],
        },
      ],
    });
    const output = serializer.serialize(doc);

    expect(output.startsWith("````")).toBe(true);
    expect(parser.parse(output)?.toJSON()).toEqual(doc.toJSON());
  });

  it("round trips a code block followed by other content", () => {
    const markdown =
      "````\ntext with a\n``` fenced line\n````\n\nA paragraph after";
    const doc = parser.parse(markdown);
    const output = serializer.serialize(doc);

    expect(parser.parse(output)?.toJSON()).toEqual(doc?.toJSON());
  });

  it("parses only the first token of the fence info string as language", () => {
    const doc = parser.parse("``` • a whole sentence here\ncontent\n```");

    expect(doc?.firstChild?.type.name).toBe("code_block");
    expect(doc?.firstChild?.attrs.language).toBe("•");
  });

  it("keeps the argument of a MyST directive in the fence info string", () => {
    const doc = parser.parse("```{figure} media/photo.png\ncontent\n```");

    expect(doc?.firstChild?.type.name).toBe("code_block");
    expect(doc?.firstChild?.attrs.language).toBe("{figure} media/photo.png");

    const output = serializer.serialize(doc!);
    expect(output.split("\n")[0]).toBe("```{figure} media/photo.png");
  });

  it("collapses whitespace in a directive info string to one line", () => {
    const doc = Node.fromJSON(schema, {
      type: "doc",
      content: [
        {
          type: "code_block",
          attrs: { language: "{figure}  media/photo.png\nnot a\tnew line" },
          content: [{ type: "text", text: "content" }],
        },
      ],
    });
    const output = serializer.serialize(doc);

    expect(output.split("\n")[0]).toBe(
      "```{figure} media/photo.png not a new line"
    );
    expect(parser.parse(output)?.firstChild?.type.name).toBe("code_block");
  });

  it("serializes an unsafe language attribute as a single safe token", () => {
    const doc = Node.fromJSON(schema, {
      type: "doc",
      content: [
        {
          type: "code_block",
          attrs: { language: " ` not a ` language" },
          content: [{ type: "text", text: "content" }],
        },
      ],
    });
    const output = serializer.serialize(doc);
    const infoLine = output.split("\n")[0];

    expect(infoLine).toBe("```not");
    expect(parser.parse(output)?.firstChild?.type.name).toBe("code_block");
  });
});

describe("highlight colors", () => {
  function highlighted(text: string, color: string | null) {
    return Node.fromJSON(schema, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Some " },
            {
              type: "text",
              text,
              marks: [{ type: "highlight", attrs: { color } }],
            },
            { type: "text", text: " prose" },
          ],
        },
      ],
    });
  }

  it("serializes an uncolored highlight as ==", () => {
    expect(serializer.serialize(highlighted("marked", null))).toBe(
      "Some ==marked== prose"
    );
  });

  it("serializes a colored highlight as a mark tag carrying the color", () => {
    expect(serializer.serialize(highlighted("marked", "#C8AFF0"))).toBe(
      'Some <mark style="background-color: #C8AFF0">marked</mark> prose'
    );
  });

  it("round trips the color of a highlight", () => {
    const doc = highlighted("marked", "#C8AFF0");
    const output = serializer.serialize(doc);

    expect(parser.parse(output)?.toJSON()).toEqual(doc.toJSON());
  });

  it("reads the color from the data attribute the editor writes", () => {
    const doc = parser.parse(
      'Some <mark data-color="#FA551E">marked</mark> prose'
    );

    expect(doc?.toJSON()).toEqual(highlighted("marked", "#FA551E").toJSON());
  });

  it("keeps other marks inside a colored highlight", () => {
    const markdown =
      'A <mark style="background-color: #3CBEFC">**bold** and *italic*</mark> end';
    const doc = parser.parse(markdown);

    expect(serializer.serialize(doc)).toBe(markdown);
  });

  it.each([
    ["no color", "<mark>plain</mark>"],
    ["an invalid color", '<mark style="background-color: red">plain</mark>'],
    ["no closing tag", '<mark style="background-color: #FDEA9B">plain'],
  ])("leaves a mark tag with %s as text", (_name, markdown) => {
    const doc = parser.parse(markdown);

    expect(doc?.toJSON()).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: markdown }] },
      ],
    });
  });

  it("leaves a stray closing tag as text", () => {
    const doc = parser.parse("plain</mark>");

    expect(doc?.firstChild?.textContent).toBe("plain</mark>");
  });
});

describe("table cell backgrounds", () => {
  const background = (color: string) => ({
    marks: [{ type: "background", attrs: { color } }],
  });

  function shadedTable() {
    return table([
      tr([th("a", background("#fdea9bb3")), th("b")]),
      tr([td("1"), td("2", background("#c8aff0b3"))]),
    ]);
  }

  it("serializes a cell background as a comment opening the cell", () => {
    const output = serializer.serialize(doc([shadedTable()])).trim();

    expect(output).toBe(
      "| <!-- bg:#fdea9bb3 -->a | b   |\n" +
        "|-----|-----|\n" +
        "| 1   | <!-- bg:#c8aff0b3 -->2 |"
    );
  });

  it("round trips cell backgrounds", () => {
    const source = doc([shadedTable()]);
    const output = serializer.serialize(source);

    expect(parser.parse(output)?.toJSON()).toEqual(source.toJSON());
  });

  it("round trips an empty shaded cell", () => {
    const source = doc([
      table([
        tr([th("a"), th("b")]),
        tr([td("", background("#fdea9bb3")), td("2")]),
      ]),
    ]);
    const output = serializer.serialize(source);

    expect(output).toContain("| <!-- bg:#fdea9bb3 --> | 2   |");
    expect(parser.parse(output)?.toJSON()).toEqual(source.toJSON());
  });

  it("reads a background off a cell holding formatted text", () => {
    const parsed = parser.parse(
      "| a | b |\n|---|---|\n| <!-- bg:#fdea9bb3 -->**bold** text | 2 |"
    );
    const cell = parsed?.toJSON().content[0].content[1].content[0];

    expect(cell.attrs.marks).toEqual([
      { type: "background", attrs: { color: "#fdea9bb3" } },
    ]);
    expect(cell.content[0].content).toEqual([
      { type: "text", text: "bold", marks: [{ type: "strong" }] },
      { type: "text", text: " text" },
    ]);
  });

  it("reads a background off a cell holding a fenced block", () => {
    const parsed = parser.parse(
      "| a | b |\n|---|---|\n| <!-- bg:#fdea9bb3 -->```python<br>print(1)<br>``` | 2 |"
    );
    const cell = parsed?.toJSON().content[0].content[1].content[0];

    expect(cell.attrs.marks).toEqual([
      { type: "background", attrs: { color: "#fdea9bb3" } },
    ]);
    expect(cell.content[0].type).toBe("code_block");
  });

  it("leaves a comment that is not a background marker as text", () => {
    const parsed = parser.parse(
      "| a | b |\n|---|---|\n| <!-- note --> 1 | 2 |"
    );
    const cell = parsed?.toJSON().content[0].content[1].content[0];

    expect(cell.attrs.marks).toBeUndefined();
    expect(cell.content[0].content[0].text).toBe("<!-- note --> 1");
  });
});
