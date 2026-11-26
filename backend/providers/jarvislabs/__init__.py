"""
JarvisLabs.ai Provider Adapter Package
======================================
Implements integration with JarvisLabs cloud GPU platform.
"""

from .client import JarvisLabsClient
from .adapter import JarvisLabsGpuProvider

__all__ = ["JarvisLabsClient", "JarvisLabsGpuProvider"]
