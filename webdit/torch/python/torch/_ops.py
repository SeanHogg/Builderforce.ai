"""Top-level op aliases (`torch.matmul`, `torch.softmax`, …): each delegates to the Tensor method."""


def matmul(input, other):  # noqa: A002 — PyTorch's signatures
    return input @ other


def add(input, other):  # noqa: A002
    return input + other


def sub(input, other):  # noqa: A002
    return input - other


def mul(input, other):  # noqa: A002
    return input * other


def div(input, other):  # noqa: A002
    return input / other


def exp(input):  # noqa: A002
    return input.exp()


def log(input):  # noqa: A002
    return input.log()


def relu(input):  # noqa: A002
    return input.relu()


def softmax(input, dim=-1):  # noqa: A002
    return input.softmax(dim)


def log_softmax(input, dim=-1):  # noqa: A002
    return input.log_softmax(dim)


def sum(input, dim=None, keepdim=False):  # noqa: A001, A002
    return input.sum(dim, keepdim)


def mean(input, dim=None, keepdim=False):  # noqa: A002
    return input.mean(dim, keepdim)


def reshape(input, shape):  # noqa: A002
    return input.reshape(shape)


def transpose(input, dim0, dim1):  # noqa: A002
    return input.transpose(dim0, dim1)


def flatten(input, start_dim=0, end_dim=-1):  # noqa: A002
    return input.flatten(start_dim, end_dim)
