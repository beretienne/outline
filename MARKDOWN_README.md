# Writing in Outline when the text ends up in Sphinx

This page is for anyone editing documentation in Outline that also gets built
into a manual with Sphinx — the HTML site, the PDF, the Word file.

You do not need to know Sphinx or Markdown to read this. The short version is:
**almost everything in Outline works.** Five or six buttons do not, and this
page tells you which, what goes wrong, and what to do instead.

## Why anything goes wrong at all

The same text lives in two places. You edit it in Outline. A sync tool copies it
into a folder of `.md` files, and Sphinx turns those into the manual.

Outline and Sphinx agree about most formatting: bold is bold, a bullet is a
bullet. But Outline has a few features Sphinx never learned to read. When that
happens, Sphinx does not stop with an error — it just prints the raw characters,
or quietly renders something different. Nobody notices until the PDF is on
someone's desk.

That is the whole problem. This page is the list.

---

## The short version

| | |
| --- | --- |
| ✅ **Safe** | bold, italic, `code`, links, all lists, checkboxes, tables, quotes, code blocks, dividers, callouts, math, images |
| ⚠️ **Careful** | strikethrough, links to other collections, resizing images |
| ❌ **Avoid** | highlight, underline, placeholder, toggle block, emoji |

If you only remember one thing: **use the four callout types instead of the
toggle block, and use bold instead of highlight or underline.**

---

## Text formatting, one button at a time

### ✅ Bold, italic, code

These are fine. Use them freely.

### ❌ Highlight — Ctrl+Shift+H, or typing `==text==`

You see yellow highlighting in Outline. **The manual shows the equals signs.**

> You type: `The ==reference point== is at the centre.`
>
> Sphinx prints: The ==reference point== is at the centre.

**Instead:** use **bold**.

### ❌ Underline — Ctrl+U, or typing `__text__`

This one is worse than highlight, because nothing looks broken. Underline is
written as `__text__`, and Sphinx reads two underscores as **bold**.

> You type: <u>not applicable</u> (underlined)
>
> Sphinx prints: **not applicable** (bold)

Nobody gets an error. The emphasis just quietly changes meaning. If the
underline was carrying meaning — "this is the corrected value" — that meaning is
gone.

**Instead:** use **bold** or *italic*, and pick the one you actually mean.

### ❌ Placeholder — the template placeholder control

Placeholders are for document templates that get filled in when someone creates
a new document. They are written as `!!text!!`, which Sphinx prints literally.

> Sphinx prints: !!serial number!!

**Instead:** if the document is going into the manual, fill the placeholder in
before it ships. Placeholders belong in templates, not in published pages.

### ⚠️ Strikethrough — Ctrl+D, or typing `~~text~~`

This one half works, and the half that fails is the dangerous half.

- In the **HTML site**: shows correctly, struck through.
- In the **PDF and Word**: the text appears **normally, with no line through
  it**.

So `~~not~~ applicable` becomes "not applicable" in the PDF — the exact opposite
of what you wrote.

The build prints a warning for every strikethrough, so they can be found. But do
not rely on that.

**Instead:** if the point is that something no longer applies, write it in
words: "no longer applies", "withdrawn in version 2". Delete the text rather
than striking it, and let the document history remember it.

---

## Blocks

### ✅ Callouts — "Info notice", "Warning notice", "Tip notice", "Success notice"

These work properly and are the right tool for anything you want set apart from
the prose. Each one becomes a real Sphinx admonition:

| Outline button | Becomes in Sphinx | Use it for |
| --- | --- | --- |
| Info notice | `note` | something the reader should know |
| Tip notice | `tip` | advice that makes the job easier |
| Warning notice | `caution` | something that can go wrong |
| Success notice | `seealso` | a pointer to related material |

Each theme colours these its own way, so pick by meaning rather than by the
colour you see in Outline.

**Callouts can have a title.** If you write the document in the source tree
rather than in Outline, you can use any of Sphinx's admonition types and give it
a heading:

````markdown
```{admonition} Read this before wiring the camera
:class: danger

Disconnect the power supply first.
```
````

That arrives in Outline as a proper coloured callout with **Read this before
wiring the camera** in bold at the top, and it goes back out unchanged. The
types you can use are `note`, `tip`, `hint`, `important`, `caution`, `warning`,
`attention`, `danger`, `error`, `seealso`, and the generic `admonition`.

Editing the body of one of these in Outline is safe. The title comes back
exactly as it was.

### ❌ Toggle block — the collapsible "▸" block

Sphinx has never heard of it. The manual shows a row of plus signs:

```
+++++
The hidden text is here.
+++++
```

**Instead:** use a callout, or just a small heading followed by the text. A
printed manual cannot collapse anything anyway.

### ✅ Code blocks

Fine, including the language dropdown.

**One exception: never put a code block inside a callout.** A callout and a code
block are both marked with ` ``` `, so the callout ends at the code block
instead of wrapping it. The damage builds up rather than showing all at once —
every time the page is saved the block collects another stray ` ``` ` line, and
the text that was below the code block drifts out of the callout.

Put the code block just after the callout instead:

````markdown
```{note}
Run the calibration first.
```

```bash
qcam-calibrate --section 4
```
````

### ✅ Tables, bullet lists, numbered lists, checkboxes, quotes, dividers

All fine.

### ✅ Maths

Both `$x^2$` inside a sentence and a standalone block work.

---

## Images

### ✅ Inserting an image

Fine. **Write alt text** — the short description of what the picture shows. It
carries through to the built manual, where screen readers use it and where it is
shown if the image itself fails to load.

### ⚠️ Resizing an image by dragging its corner

Outline records the size in a way Sphinx reads as a *tooltip*, not a size:

```
![A camera](media/photo.png " =800x600")
```

The manual shows the image at **full size**, and hovering over it shows the odd
text `=800x600`.

**Instead:** leave the image at its natural size in Outline. If it really needs
to be smaller in the manual, ask whoever maintains the source tree to set the
width there — it is one line:

```markdown
![A camera](media/photo.png){width="50%"}
```

That form survives editing in Outline untouched.

---

## Links

### ✅ Linking to another page in the same documentation space

Fine. The sync rewrites it into a path that works in the built manual.

### ⚠️ Linking to a page in a *different* collection

The link keeps its Outline address, something like `/doc/installation-x7f3a`.
Inside Outline it works. In the built manual it is **broken** — it points at a
page Sphinx has never seen.

**Instead:** paste the full public address of the page (`https://…`), or link to
a page inside the same documentation space.

### ⚠️ Mentioning a person with `@`

A mention becomes a link to an Outline user page, which means nothing in a PDF.
Write the person's name as plain text instead.

---

## ❌ Emoji

Typing `:smile:` and picking an emoji inserts something that Sphinx prints
literally:

> Sphinx prints: :smile:

**Instead:** paste the actual emoji character (🙂) if you want one, or leave it
out. Emoji rarely survive a PDF conversion well either.

---

## Things that change by themselves — this is normal

You may notice that after a page is synced, the source file looks slightly
different even though nobody edited it:

- `-` bullets become `*` bullets
- table columns get padded with spaces so they line up
- callouts gain a blank line before their closing marker
- `:::` markers become ` ``` ` markers

**None of this changes what the reader sees.** It happens once, the first time a
page goes through, and then the file stays put. It is not a sign that something
went wrong.

---

## If you already know MyST

You can type MyST directly into Outline and it survives the round trip. These
all come back exactly as you wrote them:

- directives Outline has no button for: `{margin}`, `{eval-rst}`
- every admonition, with its title and its options
- roles: `` {term}`resolution` ``
- cross-reference targets: `(my-label)=`
- substitutions: `{{ CAM }}`
- comments: `% this line is a comment`
- images with attributes: `![alt](photo.png){width="50%"}`
- raw HTML

While you are editing, the ones Outline has no button for show up as plain grey
code blocks rather than rendered content. That is expected — Outline is holding
them for you, not interpreting them.

**Two directives are rewritten by the sync tool, not by Outline.** They are
turned into ordinary Markdown on the way in, and they do not turn back:

| You write | It becomes |
| --- | --- |
| ```` ```{figure} photo.png ```` with a caption | `![](photo.png){width="…"}` followed by the caption in *italics* |
| ```` ```{rubric} Heading ```` | `### Heading` |

The picture and the words survive; what is lost is that Sphinx knew one was a
numbered figure with a caption and the other was an unnumbered heading. If you
need a real numbered figure, keep that page out of the Outline sync, or accept
the plain image.

**One hard limit:** a directive whose body contains a code fence gets cut short
at the inner fence. Do not wrap a code block inside `{margin}`, `{figure}` or
similar — the same trap as a code block inside a callout, above.

---

## Found something this page does not cover?

Tell whoever maintains the sync, and describe what you did in Outline and what
came out in the manual. The rules on this page are enforced by a test file,
`server/editor/myst.test.ts`, which pins the exact output of every construct
listed here. If Outline's behaviour ever drifts, that test fails before anyone
finds it in a PDF — and new cases get added there.
