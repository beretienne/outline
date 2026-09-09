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
strikethrough in printed output, image resizing, links to other collections

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

Come through perfectly, language dropdown included.

**One arrangement to keep an eye out for: a code block tucked inside a
callout.** Both are fenced with ` ``` `, so the callout closes at the code block
rather than wrapping around it, and the two drift apart a little more each time
the page is saved. A longer outer fence does not rescue it either, because the
closing fence is always written back with three backticks.

Putting the code just below the callout reads better anyway:

````markdown
```{note}
Run the calibration first.
```

```bash
qcam-calibrate --section 4
```
````

### Tables, bullet lists, numbered lists, checkboxes, quotes, dividers

All come through perfectly.

**Shading a table cell** stays in Outline, and comes back after a sync. A
shaded cell opens with a small HTML comment naming its colour, which the manual
does not show — the cell simply reads as plain:

```markdown
| <!-- bg:#fdea9bb3 -->Status | Owner |
```

The colour goes wherever the cell goes, so editing the cell's text keeps it.
Deleting the comment is how you clear the shading from the source side.

### Maths

Both `$x^2$` inside a sentence and standalone blocks work.

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

- `-` bullets become `*` bullets
- table columns get padded so they line up
- callouts gain a blank line before their closing marker
- `:::` markers become ` ``` ` markers

**This is housekeeping, and readers see no difference.** It happens once, the
first time a page goes through, and then the file settles down for good.

---

## If you already know MyST

You can write MyST straight into Outline and it comes back exactly as you typed
it:

- directives Outline has no button for: `{margin}`, `{eval-rst}`
- every admonition, with its title and its options
- roles: `` {term}`resolution` ``
- cross-reference targets: `(my-label)=`
- substitutions: `{{ CAM }}`
- comments: `% this line is a comment`
- images with attributes: `![alt](photo.png){width="50%"}`
- raw HTML

While you are editing, the ones Outline has no button for appear as plain grey
code blocks rather than rendered content. That is Outline holding them safe for
you rather than trying to interpret them.

**Two directives are simplified by the sync tool** on the way in, and stay
simplified:

| You write | It becomes |
| --- | --- |
| ```` ```{figure} photo.png ```` with a caption | `![](photo.png){width="…"}` and the caption in *italics* |
| ```` ```{rubric} Heading ```` | `### Heading` |

The picture and the words come through; what is set aside is Sphinx's knowledge
that one was a numbered figure and the other an unnumbered heading. If a page
depends on numbered figure references, keep it out of the Outline sync.

**Two arrangements to avoid**, both shared with callouts:

- A code fence inside a directive. Both use ` ``` `, so the directive closes
  early. Keep code blocks alongside directives rather than inside them.
- A directive nested inside an admonition — a `{figure}` or `{figure-md}` inside
  an `{admonition}`, say. The outer block keeps its plain code-block appearance
  rather than becoming a callout. Nothing is lost, but if you wanted the colour,
  put the figure after the admonition rather than inside it.

---

## Something not covered here?

Do tell whoever looks after the sync — describe what you did in Outline and what
you saw in the manual. Everything on this page is backed by a test file,
`server/editor/myst.test.ts`, which pins the exact output of each case listed
here. New findings get added there, so the list stays true and anything that
drifts shows up long before it reaches a PDF.
