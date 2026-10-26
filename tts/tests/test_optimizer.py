import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto

from optimize_paradee import constants


def test_static_projection_is_reproducible_and_random_excitation_is_preserved():
    left = np.array([[.125, -.25, .5]], dtype=np.float32)
    right = np.array([[.2, -.4], [.7, .1], [-.5, .3]], dtype=np.float32)
    bias = np.array([.15, -.15], dtype=np.float32)
    def model():
        nodes = [helper.make_node("Gemm", ["a", "b", "bias"], ["projected"]), helper.make_node("RandomNormalLike", ["projected"], ["noise"])]
        return helper.make_model(helper.make_graph(nodes, "fixture", [], [helper.make_tensor_value_info("noise", TensorProto.FLOAT, [1, 2])], [numpy_helper.from_array(a, name) for name, a in [("a", left), ("b", right), ("bias", bias)]]), opset_imports=[helper.make_opsetid("", 17)])
    first, second = model(), model()
    constants(first); constants(second)
    assert first.SerializeToString() == second.SerializeToString()
    assert [n.op_type for n in first.graph.node] == ["RandomNormalLike"]
    projected = next(numpy_helper.to_array(i) for i in first.graph.initializer if i.name == "projected")
    expected = (left.astype(np.float64) @ right.astype(np.float64) + bias.astype(np.float64)).astype(np.float32)
    np.testing.assert_array_equal(projected, expected)
    onnx.checker.check_model(first)
