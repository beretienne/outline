# Writing in Outline when the text ends up in Sphinx

This page is for anyone editing documentation in Outline that also gets built
into a manual with Sphinx — the HTML site, the PDF, the Word file.

You do not need to know Sphinx or Markdown to read it. **Outline is a good place
to write these documents, and nearly everything in the editor comes through
exactly as you left it.** A handful of controls have no equivalent on the Sphinx
side, and for each of those there is a simple alternative that does the same job
and travels everywhere. That is what this page is: the short list, and what to
reach for instead.

Every case below has a simple fix, and most you will never meet. Write freely.

## Why there is a list at all

The same text lives in two places. You edit it in Outline. A sync tool copies it
into a folder of `.md` files, and Sphinx turns those into the manual.

The two tools agree about most formatting: bold is bold, a bullet is a bullet.
A few of Outline's flourishes are its own, though, and Sphinx has no way to
draw them — so it prints them as written, or renders the nearest thing it
knows. Neither is dramatic, but both are easy to sidestep once you know which
controls they are.

---

## At a glance

**Use freely — these come through everywhere**
bold, italic, `code`, links, bullet lists, numbered lists, checkboxes, tables,
quotes, code blocks, dividers, callouts, maths, images

**These have a better travelling companion**

| Instead of | Reach for |
| --- | --- |
| Highlight | **Bold** |
| Underline | **Bold** or *italic* |
| Toggle block | A callout, or a small heading |
| Emoji picker | The emoji character itself, pasted in |
| Placeholder | Fill it in before the page ships |

**Good to know**
strikethrough in printed output, image resizing, links to other collections,
captions (an Outline caption is not a Sphinx caption), Sphinx blocks and glossary terms

If you remember one thing: **callouts are excellent, use them.**

---

## Text formatting

### Bold, italic, code

Come through perfectly. Use them as much as you like.

### Highlight — Ctrl+Shift+H, or typing `==text==`

Highlighting is a lovely reading aid inside Outline. Sphinx has no highlight of
its own, so in the manual the equals signs show up as text:

> **In Outline** you see *reference point* in yellow.
>
> **In the manual** the sentence reads: The ==reference point== is at the
> centre.

**Reach for bold instead.** It carries the same "look here" and appears in every
output.

**Picking a highlight colour** from the toolbar is a different story. A coloured
highlight is stored as an HTML `<mark>` tag carrying its colour, and the HTML
manual renders that as a real highlight in the same colour. A PDF build drops
the tag and prints the text plain. The colour also survives a sync in both
directions, so the shade you chose in Outline is still there after the page
has been pulled and pushed:

```markdown
The <mark style="background-color: #C8AFF0">reference point</mark> is at the centre.
```

### Underline — Ctrl+U, or typing `__text__`

Underline is written as `__text__`, and Markdown has long read two underscores
as bold — so that is what the manual shows. Nothing goes wrong; the emphasis
simply arrives as **bold** rather than underlined.

Worth knowing if the underline was doing real work, as in "this is the corrected
value". **Bold or italic will carry that meaning deliberately**, and you get to
choose which.

### Placeholder

Placeholders are a template feature: they mark the spots someone fills in when
creating a new document from a template. They are written as `!!text!!`, so if
one is still in the page when it ships, the manual shows `!!serial number!!`.

**Fill them in before the page goes out** — which is what they are asking for
anyway.

### Strikethrough — Ctrl+D, or typing `~~text~~`

This one works on the web and is worth knowing about for print:

- **HTML site** — shows exactly as you wrote it, struck through.
- **PDF and Word** — the text appears without the line through it.

So a print reader sees "not applicable" where a web reader sees ~~not
applicable~~. The build lists every strikethrough it finds, so they are easy to
review before a release.

**If the point needs to reach print readers, say it in words** — "no longer
applies", "withdrawn in version 2" — or delete the text and let the document
history remember it.

### Glossary term — the **Glossary term** toolbar button, or typing `` {term}`text` ``

Select some words and click **Glossary term** (the library icon, next to inline
code) to mark them as a reference to a glossary entry, the way Sphinx's
`` {term}`text` `` role does. Click again to remove it. Typing
`` {term}`field of view` `` with the closing backtick does the same.

In Outline it shows like every other role: the words on a light background,
with `{term}` in small grey letters in front of them. That is all: it is a
marker, not a link, and nothing happens on click. It travels exactly as
written. A glossary term is simply the role named `term` (see
[Other roles](#other-roles--the-myst-role-toolbar-button-or-typing-nametext)),
so its text is edited the same way. Bold, italics, links and code cannot be
applied inside one, because Sphinx reads what is between the backticks
literally. Only the plain form is supported; Sphinx's
`` {term}`Display text <target>` `` is kept as typed but not interpreted.

### Other roles — the **MyST role** toolbar button, or typing `` {name}`text` ``

Every other MyST role — `` {ref}`see the values <deployment_values>` ``,
`` {abbr}`HTTP (HyperText Transfer Protocol)` ``, `` {math}`x^2` ``, or a role
your project defines itself, like `` {dot}`1` `` — is shown as its text on a
light background, with the role's name in small grey letters in front of it.

Select some words and click **MyST role** (the **#** icon, next to Glossary
term), type the role's name — `ref`, `abbr`, `dot` — and press **Enter**. As
you type, matching roles are listed below the field — the standard ones and
the ones this collection's pages already use — to pick with ↓/↑ and Enter, or
a click. Typing `` {dot}`1` `` with its closing backtick does the same, and
pasted or synced text arrives as roles too.

**To rename or remove one**, select its text (double-click works) and click
**#** again: the field shows the current name — change it and press Enter, or
click the bin to turn the role back into plain text. **Escape** closes the
field without changing anything. Naming a role `term` makes it a glossary term.

**To change what a role says**, just edit its text. Deleting its last
character, or typing over it, keeps the role: it stays as an empty tag with
its name until you type the new text. Once you have deleted or typed at its
end, the role is outlined and everything you type goes into it; press **→**
to step out and carry on typing after it, or just click elsewhere. Move the
cursor away from an empty tag before typing and the empty role is dropped.

Like a glossary term, it is a marker only: a `{ref}` is not a link in Outline,
and nothing checks that the label it points at exists — that happens when
Sphinx builds the manual. It travels exactly as written, and formatting can't
be applied inside it.

For a `{ref}`, Sphinx only finds link text on its own when the target sits
right before a heading. Anywhere else, give it yourself:
`` {ref}`see the values <deployment_values>` ``.

---

## Blocks

### Callouts — the star of the show

"Info notice", "Warning notice", "Tip notice" and "Success notice" all become
real Sphinx admonitions, properly styled in every output. This is the best tool
in the editor for setting something apart from the prose.

| Outline button | Becomes in Sphinx | Good for |
| --- | --- | --- |
| Info notice | `note` | something the reader should know |
| Tip notice | `tip` | advice that makes the job easier |
| Warning notice | `caution` | something that can go wrong |
| Success notice | `seealso` | a pointer to related material |

Each theme colours these its own way, so pick by meaning rather than by the
colour you see in Outline.

**Callouts can also have a title, and more types are available.** There is no
button for it in the editor, but if the page is written in the source tree you
can use any of Sphinx's admonitions and give it a heading:

````markdown
```{admonition} Read this before wiring the camera
:class: danger

Disconnect the power supply first.
```
````

That arrives in Outline as a proper coloured callout with **Read this before
wiring the camera** in bold at the top, and goes back out exactly as it came in
— title, options and all. You can edit the body in Outline freely.

The types available are `note`, `tip`, `hint`, `important`, `caution`,
`warning`, `attention`, `danger`, `error`, `seealso`, and the general-purpose
`admonition`.

**Titles are plain text.** Writing `{admonition} **Important note**` shows the
asterisks rather than bold. No need for them — the title is already rendered in
bold, so `{admonition} Important note` gives you what you were after.

**What fits inside a callout.** Prose, lists, quotes, headings and images all sit
happily inside one. A table, a standalone formula, another callout or a toggle
block do not: a callout has nowhere to put them, so the block keeps its plain
code-block appearance instead of turning into a coloured callout. Everything you
wrote is still there and still correct — it simply does not get the colour.

Putting the table or the formula just after the callout gives you both:

````markdown
```{note}
The measured values for each section are below.
```

| Section | Distance |
| --- | --- |
| A | 1200 m |
````

### Toggle block — the collapsible "▸" block

A neat trick on screen, but there is nothing to collapse in a printed manual, so
Sphinx has no equivalent and shows a row of plus signs instead.

**A callout does the job nicely**, or a small heading with the text underneath.

### Code blocks

Come through perfectly, language dropdown included, even one dropped inside a
callout — the callout writes a longer outer fence to clear it, so the two
never collide however deep the nesting goes.

### Tables, bullet lists, numbered lists, checkboxes, quotes, dividers

All come through perfectly.

**A page break is a divider in the manual.** Outline's "Page break" is written
`***`, which Sphinx reads exactly like a divider (`---`): a horizontal line, in
the HTML site and in the PDF alike — never a new page. Outline keeps it as a
page break on its side, so nothing is lost in the sync, but it does nothing
more than a divider in the manual. For a real new page in the PDF, the source
uses a raw LaTeX block, which Outline shows as a framed directive box holding
the LaTeX as plain text (see [Every other directive](#every-other-directive--raw-eval-rst-tabularcolumns-and-custom-ones)):

````markdown
```{eval-rst}
.. raw:: latex

   \pagebreak
```
````

**Not directly under a heading.** Sphinx refuses a divider (or page break) as
the very first thing in the page or in a section — the build reports it as an
error. Put at least a line of text between the heading and the divider.

**Shading a table cell** stays in Outline, and comes back after a sync. A
shaded cell opens with a small HTML comment naming its colour, which the manual
does not show — the cell simply reads as plain:

```markdown
| <!-- bg:#fdea9bb3 -->Status | Owner |
```

The colour goes wherever the cell goes, so editing the cell's text keeps it.
Deleting the comment is how you clear the shading from the source side.

### Sphinx blocks — the **Sphinx directive** menu entry

Type `/directive` and open **Sphinx directive** (→ or Enter): it lists every
MyST directive, each with a one-line description, plus the ones this
collection's pages already use (a project's own `{vm}`, say). Or type the
directive's own name straight after `/` — `/ifconfig`, `/raw`, `/eval` — and
the list narrows as you type. Each shows as a framed box with its directive
name in the corner, and comes back as the MyST directive you would have
written by hand.

| Directive | Gives you | Notes |
| --- | --- | --- |
| `{ifconfig}` | conditional content | Click the label and add the condition: `{ifconfig} Class == 'A'`. |
| `{grid}` | `{grid} 2` | Edit the label to change the number of columns. |
| `{grid-item}` | a grid cell | Use it *inside* a grid; it nests instead of replacing the grid. |
| `{margin}` | a margin note | |
| `{glossary}` | a glossary | Starts with one blank entry, described below. |
| `{note}`, `{warning}`… | a callout | Written back as that admonition. |
| any other | a box with a plain-text area | See "Every other directive" below. |

The name and argument in the corner can be edited in place; a label without
braces around the name is refused. What the argument means to Sphinx is up to
you.

#### Every other directive — {raw}, {eval-rst}, {tabularcolumns} and custom ones

Any other directive — `{raw} latex`, `{eval-rst}`, `{tabularcolumns}`,
`{toctree}`, `{dropdown}`, a project's own `{vm}` — shows as the same framed box
with its name and argument in the corner, editable the same way. What is inside
is **not** read as Markdown: MyST hands it to the directive as it is (LaTeX,
reStructuredText, a CSV table…), so Outline keeps it in a plain-text area and
writes it back exactly, character for character. A directive with no content,
such as `{tabularcolumns} |\Y{0.4}|\Y{0.6}|`, has an empty text area.

Option lines (`:header: a, b`) are kept with the directive and written back
before its content, followed by a blank line.

**A glossary** is a list of terms and definitions. Type the term, press Enter to
move to its definition, and press Enter twice to start the next entry. To
remove a blank entry, or a glossary that is still blank, press Backspace inside
it. A glossary cannot be placed inside another glossary's definition.

**Figures** are inserted the same way — see [Captions](#captions-a-caption-in-outline-is-not-a-caption-in-the-manual).

#### Reading a page without the Sphinx markup

In **Settings → Preferences**, **Hide Sphinx markup when reading** shows pages
the way a reader of the manual sees them: roles read as plain text; comments,
cross-reference targets and plain-text directives (`{raw}`, `{eval-rst}`…)
disappear; `{grid}`, `{margin}` and the like keep their content without the
frame. An `{ifconfig}` keeps a dashed frame labelled **Option · Class == 'A'**,
and neighbouring ones are drawn as one group — the variants the manual is
built from. Only the display changes, never the page itself, and everything
shows again as soon as you click **Edit** (with "Separate editing" off, pages
are always being edited, so the setting has no effect).

### Comments — lines starting with %

A line starting with `%` is a MyST comment: Sphinx drops it from the built
manual entirely. Outline shows each commented line greyed out, behind a thin
rule, instead of hiding it — so it stays visible and editable, but it is
never published. Every commented line stands on its own, exactly as in the
source file.

**To comment something out**, put the cursor in it (or select several
lines) and press **Ctrl+/** (**Cmd+/** on a Mac), or type `/` and pick
**Comment (not published)**. Each line becomes one commented line — list
markers, indentation, bold and links included, kept as their Markdown. A
list item taken out this way leaves the rest of its list in place. To start
a new comment line from scratch, type `% ` at the start of an empty
paragraph; Enter starts the next comment line, Enter on an empty one leaves
the comment.

**To put a line back**, press Backspace at its very start, or **Ctrl+/**
again (which also works on a selection of several comment lines). The line
comes back exactly as it was before its `%` was added — the same as deleting
the `%` in the source file: a list item returns to its list at its own
indentation, a glossary entry returns into its glossary, formatting comes
back. The lines around it stay commented until you put them back too.

An untouched comment writes back exactly as it was read, blank lines and
all. That includes spaces at the end of a line: a line ending in a hard line
break (two trailing spaces) keeps them while commented out, and gets its
break back when it is put back. Lines a hard break joins go back together:
putting back either one brings the other with it, since a line on its own
cannot keep a break at its end.

**A divider** (or a page break) has no line to put the cursor in: select it
with the arrow keys — move onto it from the line above or below — then press
**Ctrl+/**. It becomes a comment line reading `---` (or `***`), and comes back
as a divider the same way as any other line.

`50% of a page` is not a comment — only a `%` at the very start of a line
counts, matching MyST's own rule.

**In a glossary.** Comment out any line of a definition — its first line
included — and only that line goes; the term keeps its entry. Comment out a
term and its whole entry goes with it. Every entry of a glossary can be
commented out this way: Sphinx builds the glossary, empty, without
complaint.

In the source, a commented-out *entry* is not written with `%` but with `..`:

```markdown
:::{glossary}
.. Detection field size error
..    The error in *detection field* size.
:::
```

This is not a MyST comment — MyST's own documentation only knows `%`. A
`{glossary}` is the exception: Sphinx reads its lines itself, the
reStructuredText way, before MyST sees any of them, and at that level a
`% Term` line is published as a glossary term, `%` and all, while `..` is the
one comment it skips. A commented line *inside* a definition keeps its `%`,
indented with the definition: that part goes through MyST again, where `%`
works.

### Cross-reference targets — lines reading `(label)=`

A line by itself reading `(label)=` marks the block right after it — usually
a heading or a figure — so `{ref}` and `{numref}` elsewhere in the manual can
point at it by that label. Nothing is rendered for it in the built manual.

Outline shows it as a small dimmed tag reading `(label)=`. Type `/` and pick
**Cross-reference target** to insert one: the cursor is already inside it,
so type the label straight away. Only the label is editable — the `(` and
`)=` around it are not. **Enter** moves on to a new paragraph below.

**To remove one**, delete its label, then press **Backspace** once more. A
target left empty is not written to the Markdown at all.

### Maths

Both `$x^2$` inside a sentence and standalone blocks work.

**Typing it in the editor** uses two dollar signs where the manual uses one:

| You type | You get | In the manual's source |
| --- | --- | --- |
| `$$x^2$$` | a formula inside the sentence | `$x^2$` |
| `$$$` then a space, at the start of a line | a standalone formula block | `$$`…`$$` on lines of their own |

Typing `$x^2$` with single dollar signs stays plain text, so a sentence such as
"costs $5 or $10" is never mistaken for a formula. Text pasted or synced with
`$x^2$` in it does arrive as a formula.

**Bold maths goes inside the formula.** Write `$$\mathbf{s}$$` for bold
upright letters and digits, or `$$\boldsymbol{\Delta t}$$` for bold italic,
Greek letters and symbols included. That is the only form that looks bold in
Outline, the HTML manual and the PDF alike.

Typing `**$$x$$**` does not bold it: by the time the closing asterisks arrive,
the formula has already become a formula, and those shortcuts only apply to
text. Selecting the formula (Shift+→ from just before it) and pressing **Ctrl+B**
does add bold around it, written `**$x$**`, and it is kept through every sync.
It changes nothing you can see, though: formulas are drawn in their own fonts,
in Outline and in the manual, and ignore bold or italic around them. Reach for
`\mathbf` instead.

---

## Images

### Inserting an image

Works well. **Do write alt text** — the short description of what the picture
shows. It carries through to the manual, where screen readers use it and where
it appears if the image cannot load.

### Resizing an image by dragging its corner

Your resize shows in Outline, and readers of the Outline page see it. Sphinx
reads that size as the image's title rather than its width, so in the manual the
image appears at full size, with `=800x600` as a small tooltip.

**If a specific width matters in the manual**, it is one line in the source, and
that form survives editing in Outline untouched:

```markdown
![A camera](media/photo.png){width="50%"}
```

Otherwise leaving images at their natural size is perfectly fine.

### Captions: a caption in Outline is *not* a caption in the manual

Outline lets you write a caption under any image. That text is stored as the
image's **alt text** — `![your caption](media/photo.png)` — and that is all
it is to Sphinx: a description for screen readers, shown only if the image
cannot load. **It does not appear under the picture in the built manual.**

**When the manual needs a visible caption, use a `{figure-md}`.** In Outline
the quickest way is the `/figure` entry in the block menu (type `/` and pick
**Figure**): choose an image and it is inserted as a `{figure-md}` instead of a
plain image, then click it and write the caption in the field underneath. It is
the same picture, resizing and alignment as any other image; the difference is
only what the manual gets. The text form, for pasting or for editing the source
directly:

````markdown
```{figure-md} optional-label
![](media/photo.png){width=600}

The caption, as it should appear under the picture.
```
````

Paste that in (or import a page that has one) and Outline shows it as an
ordinary image with its caption, fully editable — resize it, align it, rewrite
the caption — and saves it back as the same `{figure-md}`, label included. An image that did *not* arrive as a `{figure-md}` stays a plain
image, caption or not; Outline never turns one into the other on its own.

#### The installation-wide switch: `MYST_FIGURE_FOR_CAPTIONED_IMAGES`

An administrator can set `MYST_FIGURE_FOR_CAPTIONED_IMAGES=true` in the
server environment. It is **off by default**. With it on, whenever a document
is turned into Markdown — the API's `text`, exports, downloads, copy as
Markdown, and therefore everything the sync tool pulls — an image is written
as a `{figure-md}` instead of `![caption](…)` when **all** of these hold:

- it has a caption;
- it stands alone in its paragraph (not mid-sentence, not next to another
  image);
- it is not inside a table cell;
- it is not a link, not a diagrams.net diagram, and has no title.

Every other image is written exactly as before. Width and left/right
alignment carry over (`{width=300 align=left}`); the figure gets no label,
since Outline has nowhere to type one for a plain image — add it in the
source afterwards if something needs to cross-reference it.

What to know before turning it on:

- **It applies to the whole installation**, every collection, including pages
  that are not headed for Sphinx. Any other Markdown reader shows a
  `{figure-md}` as a code block.
- **Nothing stored in Outline changes.** Only the Markdown written out does;
  switch it off and the plain image form comes back. The change becomes
  permanent for a page only once that Markdown is brought back *in* (a sync
  push, an import): from then on the image is a real `{figure-md}` and stays
  one whatever the switch says.
- **It is the migration path**: switch on, pull, and every captioned image in
  the pulled files is a figure; push those files back and they are figures in
  Outline too.

---

## Links

### To another page in the same documentation space

Works well. The sync turns it into a path that resolves in the built manual.

### To a page in a different collection

The link keeps its Outline address, something like `/doc/installation-x7f3a`.
That is exactly right inside Outline. The manual cannot follow it, though,
since Sphinx only knows about the pages in its own tree.

**Paste the full public address** (`https://…`) when the link needs to work for
readers of the manual too.

### Mentioning a person with `@`

A mention points at an Outline user page, which readers of a PDF have no way to
open. **Write the person's name as plain text** when the page is going to print.

---

## Emoji

Picking an emoji from the `:` menu inserts a shortcode, which the manual shows
as `:smile:` rather than as a picture.

**Paste the character itself** (🙂) and it comes through fine.

---

## Things that tidy themselves up

You may notice a synced page looks slightly different in the source even though
nobody edited it:

- the spaces after a bullet (`-  item`) become one (`- item`), and nested
  items are indented to match; the bullet itself (`-`, `*` or `+`) is kept
- table columns get padded so they line up
- callouts gain a blank line before their closing marker
- `:::` markers become ` ``` ` markers

**This is housekeeping, and readers see no difference.** It happens once, the
first time a page goes through, and then the file settles down for good.

---

## If you already know MyST

You can write MyST straight into Outline and it comes back exactly as you typed
it:

- directives Outline has no button for: `{eval-rst}`, `{raw}`, `{tabularcolumns}`
- every admonition, with its title and its options
- roles: `` {term}`resolution` `` (it has a toolbar button), `` {ref}`…` ``, `` {dot}`1` `` and any other (shown as roles, see [Other roles](#other-roles--the-myst-role-toolbar-button-or-typing-nametext))
- substitutions: `{{ CAM }}`
- images with attributes: `![alt](photo.png){width="50%"}`
- raw HTML

**Comments are shown, not hidden.** Each `% this line is a comment` becomes
a greyed-out line of its own (see [Comments](#comments--lines-starting-with-)
above) rather than either disappearing or staying literal `%`-prefixed
text — Outline never silently drops content, and a MyST comment is no
exception. Both `% text` and `%text` are understood, and an untouched comment
writes back exactly as it was read.

**Cross-reference targets are shown too.** A `(my-label)=` line becomes the
small dimmed tag described in
[Cross-reference targets](#cross-reference-targets--lines-reading-label)
above, rather than staying a plain paragraph of parenthesised text.

While you are editing, the ones Outline has no button for appear as framed
directive boxes holding their content as plain text rather than rendered
content (see [Every other directive](#every-other-directive--raw-eval-rst-tabularcolumns-and-custom-ones)).
That is Outline holding them safe for you rather than trying to interpret them.

**Two directives are simplified by the sync tool** on the way in, and stay
simplified:

| You write | It becomes |
| --- | --- |
| ```` ```{figure} photo.png ```` with a caption | `![](photo.png){width="…"}` and the caption in *italics* |
| ```` ```{rubric} Heading ```` | `### Heading` |

The picture and the words come through; what is set aside is Sphinx's knowledge
that one was a numbered figure and the other an unnumbered heading. If a page
depends on numbered figure references from a `{figure}`, use a `{figure-md}`
instead (below), or keep the page out of the Outline sync.

**`{figure-md}` is not simplified** — it reaches Outline as a real figure and
comes back as you wrote it, label included, as long as it has this shape:

- one image line, with at most a pixel `width` and/or a `left`/`right`/`center`
  `align` in `{...}` directly after it (on the same line);
- then at most one caption paragraph of plain text (`*emphasis*` is fine, it
  is kept in your source; a link, a bare URL, HTML, maths or a `{role}` is not).

A `{figure-md}` outside that shape — a legend paragraph, option lines, the
`{width=…}` on the line *below* the image (MyST does not read it as an
attribute there either), two images — is flattened to an image and a caption
paragraph like a `{figure}`, and loses its label.

**When you edit a figure in Outline** (change the caption, the width, the
image), the next pull brings Outline's version back — a backtick fence, the
caption as plain text, `align=center` dropped since Outline cannot tell it from
no alignment. A figure you did *not* touch comes back exactly as it is in the
source, so a pull never quietly strips the emphasis from a caption.

**One arrangement to avoid, shared with callouts:** a code fence pasted inside
a directive as raw markdown text, both fenced with ` ``` ` at the same length.
Reachable only by pasting markdown text, not by anything the editor lets you
build — a directive Outline has no button for holds only text, so there is
nowhere to place a real nested code block from inside the editor itself. Keep
code blocks alongside directives rather than inside them.

A directive nested inside an admonition — a `{figure}` or `{figure-md}` inside
an `{admonition}`, say — keeps its own colour and stays editable; the
admonition writes a longer outer fence to clear whatever is nested inside it.

---

## Something not covered here?

Do tell whoever looks after the sync — describe what you did in Outline and what
you saw in the manual. Everything on this page is backed by a test file,
`server/editor/myst.test.ts`, which pins the exact output of each case listed
here. New findings get added there, so the list stays true and anything that
drifts shows up long before it reaches a PDF.
