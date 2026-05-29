import ApiError from "../../../errors/api_error";
import { ITokenPayload } from "../../../interfaces/token";
import { User } from "../user/user.model";
import { IComment, ICommentPayload } from "./comment.interface";
import httpStatus from "http-status";
import { Comment } from "./comment.model";
import { Types } from "mongoose";
import { Post } from "../post/post.model";

const createComment = async (
  payload: ICommentPayload,
  token: ITokenPayload
) => {
  const { _id, email } = token;
  const user = _id ? await User.findById(_id) : await User.findOne({ email });
  if (!user) {
    throw new ApiError(httpStatus.BAD_REQUEST, "User not found!");
  }
  const post = await Post.findOne({ _id: payload.postId });
  if (!post) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Post not found!");
  }
  post.commentsCount = post.commentsCount + 1;
  await post.save();
  const commentData: Omit<IComment, "parentCommentId"> = {
    postId: new Types.ObjectId(payload.postId),
    userId: user._id,
    comment: payload.comment,
  };
  if (payload.parentCommentId) {
    (commentData as IComment).parentCommentId = new Types.ObjectId(
      payload.parentCommentId
    );
  }
  const res = await Comment.create(commentData);
  return res;
};

const getCommentsByPostId = async (postId: string) => {
  // Fetch all comments for this post in a single query instead of
  // issuing N+1 queries (1 for top-level + N for each reply thread).
  const allComments = await Comment.find({ postId })
    .populate("userId", "name email")
    .populate({ path: "likes" })
    .sort({ createdAt: 1 });

  const totalComments = allComments.length;

  // Build parent → replies tree in O(N) using a lookup map.
  const repliesMap = new Map<string, typeof allComments>();
  const topLevelComments: typeof allComments = [];

  for (const comment of allComments) {
    if (comment.parentCommentId) {
      const parentId = comment.parentCommentId.toString();
      if (!repliesMap.has(parentId)) {
        repliesMap.set(parentId, []);
      }
      repliesMap.get(parentId)!.push(comment);
    } else {
      topLevelComments.push(comment);
    }
  }

  // Attach replies to each top-level comment and reverse for newest-first.
  const commentsWithReplies = topLevelComments.reverse().map((comment) => ({
    ...comment.toObject(),
    replies: repliesMap.get(comment._id.toString()) || [],
  }));

  return { comments: commentsWithReplies, totalComments };
};

const toggleCommentLike = async (commentId: string, token: ITokenPayload) => {
  const { _id, email } = token;
  const user = _id ? await User.findById(_id) : await User.findOne({ email });
  if (!user) {
    throw new ApiError(httpStatus.BAD_REQUEST, "User not found!");
  }
  const comment = await Comment.findById(commentId);
  if (!comment) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Comment not found!");
  }
  
  const hasLiked = comment.likes?.includes(user._id);
  if (hasLiked) {
    comment.likes = comment.likes?.filter((id) => id.toString() !== user._id.toString());
  } else {
    comment.likes?.push(user._id);
  }
  await comment.save();
  return comment;
};

export const CommentService = {
  createComment,
  getCommentsByPostId,
  toggleCommentLike,
};
