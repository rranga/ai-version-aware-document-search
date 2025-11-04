# 🧩 Patch for PyTorch 2.1+ meta tensor issue
import torch
from torch.nn import Module

def patch_torch():
    def safe_to(self, *args, **kwargs):
        try:
            return self._original_to(*args, **kwargs)
        except NotImplementedError:
            return self.to_empty(*args, **kwargs)

    if not hasattr(Module, "_original_to"):
        Module._original_to = Module.to
        Module.to = safe_to

device = "cuda" if torch.cuda.is_available() else "cpu"
