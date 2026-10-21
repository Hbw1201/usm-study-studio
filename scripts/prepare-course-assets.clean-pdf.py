"""Remove embedded movie actions from a static preview, preserving page content.

The original PPTX and separate MP4 remain available for playback and download.
Only generated preview PDFs are passed to this helper.
"""
import json
import pathlib
import sys
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, NameObject

source = pathlib.Path(sys.argv[1]).resolve()
destination = pathlib.Path(sys.argv[2]).resolve()
if source == destination:
    raise ValueError("Write to a temporary file, never over the source directly")
reader = PdfReader(source)
writer = PdfWriter()
removed = 0
for page in reader.pages:
    annotations = page.get("/Annots")
    if annotations:
        retained = []
        for annotation in annotations:
            if annotation.get_object().get("/Subtype") in ("/Screen", "/Movie", "/RichMedia"):
                removed += 1
            else:
                retained.append(annotation)
        if retained:
            page[NameObject("/Annots")] = ArrayObject(retained)
        else:
            page.pop("/Annots", None)
    writer.add_page(page)
if reader.metadata:
    writer.add_metadata({key: value for key, value in reader.metadata.items() if isinstance(value, str)})
with destination.open("wb") as output:
    writer.write(output)
check = PdfReader(destination)
if len(check.pages) != len(reader.pages):
    raise ValueError("Preview page count changed unexpectedly")
print(json.dumps({"pages": len(check.pages), "removedMediaAnnotations": removed, "bytes": destination.stat().st_size}))
