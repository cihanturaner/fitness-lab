"""fitness-lab backend package.

Layering (dependency direction is one-way):

    domain -> storage -> api

``domain`` is pure and must not import ``storage``, ``api`` or anything I/O bound.
"""

__version__ = "0.1.0"
